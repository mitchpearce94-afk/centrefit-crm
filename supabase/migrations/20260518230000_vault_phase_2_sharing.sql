-- =============================================================================
-- Vault Phase 2 — Folder sharing (2026-05-18)
-- =============================================================================
-- Adds the public-key discovery layer + sharing helpers needed to wrap a
-- folder key for another staff member.
--
-- Sharing flow (client-driven):
--   1. Folder owner clicks "Add member" → picks staff + role.
--   2. Owner has the folder symmetric key already (it's cached in their
--      unlocked vault session).
--   3. Owner fetches the recipient's public key via vault_public_keys.
--   4. Owner wraps the folder key with the recipient's public RSA key.
--   5. Owner inserts a vault_folder_members row with the wrapped key.
--      RLS already allows this (the existing INSERT policy accepts an
--      owner inserting any staff_id, see vault_phase_1.sql).
-- =============================================================================

-- ── vault_public_keys: discoverability layer ──────────────────────────────
-- A view restricting public_key reads to "I have vault access". Public keys
-- are non-sensitive, but exposing them only to vault users avoids an info
-- leak channel to staff who have no business sharing folders.
--
-- Implemented as a SECURITY DEFINER function (cleaner than a SELECT view +
-- WHERE clause because PostgREST treats it as a callable RPC and the
-- function body explicitly enforces the gate).

CREATE OR REPLACE FUNCTION public.vault_list_public_keys()
RETURNS TABLE (
  staff_id      UUID,
  display_name  TEXT,
  initials      TEXT,
  public_key    TEXT,
  has_vault     BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'vault_list_public_keys: not authenticated';
  END IF;
  IF NOT public.has_permission('vault.access') THEN
    RAISE EXCEPTION 'vault_list_public_keys: requires vault.access';
  END IF;

  RETURN QUERY
  SELECT
    s.id          AS staff_id,
    s.display_name,
    s.initials,
    v.public_key,
    v.staff_id IS NOT NULL AS has_vault
  FROM public.staff s
  LEFT JOIN public.vault_users v ON v.staff_id = s.id
  WHERE s.is_active
    AND s.id <> auth.uid()  -- don't return self; caller already has own keys
  ORDER BY s.display_name;
END;
$$;

-- ── helper: list folder members with names (for the share UI) ─────────────

CREATE OR REPLACE FUNCTION public.vault_list_folder_members(p_folder_id UUID)
RETURNS TABLE (
  staff_id      UUID,
  display_name  TEXT,
  initials      TEXT,
  role          TEXT,
  added_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'vault_list_folder_members: not authenticated';
  END IF;
  -- Only members can read membership.
  IF NOT EXISTS (
    SELECT 1 FROM public.vault_folder_members
    WHERE folder_id = p_folder_id AND staff_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'vault_list_folder_members: not a member of this folder';
  END IF;

  RETURN QUERY
  SELECT m.staff_id, s.display_name, s.initials, m.role, m.added_at
  FROM public.vault_folder_members m
  JOIN public.staff s ON s.id = m.staff_id
  WHERE m.folder_id = p_folder_id
  ORDER BY (m.role = 'owner') DESC, s.display_name;
END;
$$;

-- ── helper: share_folder — single-call wrap of member insert + audit log ──
-- Client still does the crypto (wrap the folder key with the recipient's
-- public key). This RPC validates that the caller is an owner and writes
-- the audit log atomically with the insert.

CREATE OR REPLACE FUNCTION public.vault_share_folder(
  p_folder_id           UUID,
  p_recipient_staff_id  UUID,
  p_role                TEXT,
  p_wrapped_folder_key  TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'vault_share_folder: not authenticated';
  END IF;
  IF p_role NOT IN ('viewer', 'editor', 'owner') THEN
    RAISE EXCEPTION 'vault_share_folder: invalid role %', p_role;
  END IF;
  -- Caller must be an owner of the folder.
  IF NOT EXISTS (
    SELECT 1 FROM public.vault_folder_members
    WHERE folder_id = p_folder_id
      AND staff_id  = v_caller
      AND role      = 'owner'
  ) THEN
    RAISE EXCEPTION 'vault_share_folder: caller is not an owner of folder %', p_folder_id;
  END IF;
  -- Recipient must have a vault set up (= public key on file).
  IF NOT EXISTS (
    SELECT 1 FROM public.vault_users WHERE staff_id = p_recipient_staff_id
  ) THEN
    RAISE EXCEPTION 'vault_share_folder: recipient has not set up their vault yet';
  END IF;
  -- Can't share the Personal folder.
  IF EXISTS (
    SELECT 1 FROM public.vault_folders
    WHERE id = p_folder_id AND is_personal
  ) THEN
    RAISE EXCEPTION 'vault_share_folder: Personal folders cannot be shared';
  END IF;

  INSERT INTO public.vault_folder_members
    (folder_id, staff_id, role, wrapped_folder_key, added_by)
  VALUES
    (p_folder_id, p_recipient_staff_id, p_role, p_wrapped_folder_key, v_caller)
  ON CONFLICT (folder_id, staff_id) DO UPDATE
    SET role               = EXCLUDED.role,
        wrapped_folder_key = EXCLUDED.wrapped_folder_key,
        added_by           = EXCLUDED.added_by,
        added_at           = now();

  PERFORM public.vault_log_event(
    'share_folder', p_folder_id, NULL,
    jsonb_build_object('recipient_staff_id', p_recipient_staff_id, 'role', p_role)
  );
END;
$$;

-- ── helper: revoke_member ─────────────────────────────────────────────────
-- Owner removes a member. Also flags the folder for key rotation in the
-- audit log so the next owner unlock can schedule a rotation (Phase 5
-- implements the actual rotation routine).

CREATE OR REPLACE FUNCTION public.vault_revoke_member(
  p_folder_id  UUID,
  p_staff_id   UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'vault_revoke_member: not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vault_folder_members
    WHERE folder_id = p_folder_id
      AND staff_id  = v_caller
      AND role      = 'owner'
  ) THEN
    RAISE EXCEPTION 'vault_revoke_member: caller is not an owner';
  END IF;
  IF p_staff_id = v_caller THEN
    RAISE EXCEPTION 'vault_revoke_member: cannot remove yourself; use leave_folder instead';
  END IF;
  -- Don't allow removing the last owner accidentally — make sure at least
  -- one owner remains after removal.
  IF (
    SELECT count(*) FROM public.vault_folder_members
    WHERE folder_id = p_folder_id AND role = 'owner' AND staff_id <> p_staff_id
  ) < 1 THEN
    RAISE EXCEPTION 'vault_revoke_member: cannot remove the last owner';
  END IF;

  DELETE FROM public.vault_folder_members
   WHERE folder_id = p_folder_id AND staff_id = p_staff_id;

  PERFORM public.vault_log_event(
    'revoke_member', p_folder_id, NULL,
    jsonb_build_object('removed_staff_id', p_staff_id, 'rotation_needed', true)
  );
END;
$$;
