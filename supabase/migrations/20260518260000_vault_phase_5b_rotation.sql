-- =============================================================================
-- Vault Phase 5b — Key rotation (2026-05-18)
-- =============================================================================
-- When a folder member is revoked, the folder key must be rotated so the
-- removed member can't read future entries (or use a cached key dump to
-- read old ones if backups leak). The actual rotation is performed by an
-- owner the next time they unlock; until then the folder is flagged.
--
-- Atomic flow:
--   1. Owner unlocks vault, sees folders with pending_rotation=true.
--   2. Client generates a new folder symmetric key.
--   3. Client decrypts every entry with the OLD folder key (still in their
--      session) and re-encrypts with the NEW key. Builds an array of
--      (entry_id, new_ciphertext, new_iv) tuples.
--   4. Client fetches remaining members' public keys, wraps the NEW key
--      with each. Builds an array of (staff_id, new_wrapped_folder_key)
--      tuples.
--   5. Single RPC call to vault_complete_rotation does the swap atomically:
--      - validates caller is owner
--      - validates the supplied member-set matches the current member-set
--        (race protection — someone else may have shared/revoked since)
--      - updates all entries' ciphertext + iv
--      - updates all members' wrapped_folder_key
--      - clears pending_rotation
-- =============================================================================

ALTER TABLE public.vault_folders
  ADD COLUMN IF NOT EXISTS pending_rotation BOOLEAN NOT NULL DEFAULT false;

-- Update vault_revoke_member to set the flag (replaces Phase 2 version).
CREATE OR REPLACE FUNCTION public.vault_revoke_member(
  p_folder_id UUID, p_staff_id UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'vault_revoke_member: not authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vault_folder_members
    WHERE folder_id = p_folder_id AND staff_id = v_caller AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'vault_revoke_member: caller is not an owner';
  END IF;
  IF p_staff_id = v_caller THEN
    RAISE EXCEPTION 'vault_revoke_member: cannot remove yourself; use leave_folder instead';
  END IF;
  IF (
    SELECT count(*) FROM public.vault_folder_members
    WHERE folder_id = p_folder_id AND role = 'owner' AND staff_id <> p_staff_id
  ) < 1 THEN
    RAISE EXCEPTION 'vault_revoke_member: cannot remove the last owner';
  END IF;

  DELETE FROM public.vault_folder_members
   WHERE folder_id = p_folder_id AND staff_id = p_staff_id;

  -- Flag the folder so the next owner unlock performs rotation.
  UPDATE public.vault_folders SET pending_rotation = true WHERE id = p_folder_id;

  PERFORM public.vault_log_event(
    'revoke_member', p_folder_id, NULL,
    jsonb_build_object('removed_staff_id', p_staff_id, 'rotation_needed', true)
  );
END;
$$;

-- ── vault_complete_rotation ─────────────────────────────────────────────
-- Takes JSONB arrays so we can do an atomic swap. The shapes are:
--   p_entries = [{ "id": "<uuid>", "ciphertext": "...", "iv": "..." }, ...]
--   p_members = [{ "staff_id": "<uuid>", "wrapped_folder_key": "..." }, ...]
-- Validates that the supplied member set EXACTLY matches the live set
-- (race protection — if a share/revoke happened between client-side
-- decryption and submit, we abort).

CREATE OR REPLACE FUNCTION public.vault_complete_rotation(
  p_folder_id UUID,
  p_entries   JSONB,
  p_members   JSONB
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller            UUID := auth.uid();
  v_entry             JSONB;
  v_member            JSONB;
  v_supplied_staff    UUID[];
  v_live_staff        UUID[];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'vault_complete_rotation: not authenticated';
  END IF;
  -- Caller must be a current owner.
  IF NOT EXISTS (
    SELECT 1 FROM public.vault_folder_members
    WHERE folder_id = p_folder_id AND staff_id = v_caller AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'vault_complete_rotation: caller is not an owner';
  END IF;

  -- Member-set match check.
  SELECT array_agg(staff_id ORDER BY staff_id) INTO v_live_staff
    FROM public.vault_folder_members WHERE folder_id = p_folder_id;
  SELECT array_agg(((m->>'staff_id')::UUID) ORDER BY (m->>'staff_id')) INTO v_supplied_staff
    FROM jsonb_array_elements(p_members) m;
  IF v_live_staff IS DISTINCT FROM v_supplied_staff THEN
    RAISE EXCEPTION 'vault_complete_rotation: member set changed since client started rotation — retry';
  END IF;

  -- Apply new wrapped keys per member.
  FOR v_member IN SELECT * FROM jsonb_array_elements(p_members)
  LOOP
    UPDATE public.vault_folder_members
       SET wrapped_folder_key = v_member->>'wrapped_folder_key',
           added_at           = now()  -- record the rotation timestamp
     WHERE folder_id = p_folder_id
       AND staff_id  = (v_member->>'staff_id')::UUID;
  END LOOP;

  -- Apply new ciphertext/iv per entry.
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    UPDATE public.vault_entries
       SET ciphertext = v_entry->>'ciphertext',
           iv         = v_entry->>'iv',
           updated_at = now()
     WHERE id = (v_entry->>'id')::UUID
       AND folder_id = p_folder_id;
  END LOOP;

  -- Clear the rotation flag.
  UPDATE public.vault_folders SET pending_rotation = false WHERE id = p_folder_id;

  PERFORM public.vault_log_event(
    'rotate_folder_key', p_folder_id, NULL,
    jsonb_build_object(
      'entries_rotated', jsonb_array_length(p_entries),
      'members_rewrapped', jsonb_array_length(p_members)
    )
  );
END;
$$;

-- ── vault_list_pending_rotations ────────────────────────────────────────
-- Returns folders the caller owns that are awaiting rotation, with the
-- current member roster so the client can fetch public keys in one go.

CREATE OR REPLACE FUNCTION public.vault_list_pending_rotations()
RETURNS TABLE (
  folder_id    UUID,
  folder_name  TEXT,
  members      JSONB        -- [{ staff_id, public_key }, ...]
) LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'vault_list_pending_rotations: not authenticated';
  END IF;
  RETURN QUERY
  SELECT
    f.id,
    f.name,
    COALESCE(
      jsonb_agg(jsonb_build_object('staff_id', vu.staff_id, 'public_key', vu.public_key)
                ORDER BY vu.staff_id)
      FILTER (WHERE vu.staff_id IS NOT NULL),
      '[]'::jsonb
    ) AS members
  FROM public.vault_folders f
  JOIN public.vault_folder_members m ON m.folder_id = f.id AND m.staff_id = v_caller AND m.role = 'owner'
  LEFT JOIN public.vault_folder_members m2 ON m2.folder_id = f.id
  LEFT JOIN public.vault_users vu ON vu.staff_id = m2.staff_id
  WHERE f.pending_rotation = true
  GROUP BY f.id, f.name
  ORDER BY f.name;
END;
$$;
