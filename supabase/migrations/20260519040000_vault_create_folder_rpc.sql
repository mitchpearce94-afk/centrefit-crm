-- =============================================================================
-- vault_create_folder RPC (2026-05-19)
-- =============================================================================
-- Fixes the "new row violates row-level security policy for table
-- vault_folders" error when the client tried to create a shared folder
-- via two separate inserts (folder, then folder_members).
--
-- Root cause: the client used `.insert(...).select("id").single()` on
-- vault_folders. PostgreSQL evaluates the SELECT policy against
-- RETURNING rows; since no vault_folder_members row exists yet at that
-- moment, the SELECT policy denies and Postgres surfaces it as the RLS
-- "new row violates" error (yes, even though it's the SELECT side
-- failing — the error string is the same).
--
-- Resolution: do both inserts atomically inside a SECURITY DEFINER RPC,
-- mirroring the existing setup_vault / vault_share_folder pattern.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.vault_create_folder(
  p_name TEXT,
  p_wrapped_folder_key TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller    UUID := auth.uid();
  v_folder_id UUID;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'vault_create_folder: not authenticated';
  END IF;
  IF NOT public.has_permission('vault.access') THEN
    RAISE EXCEPTION 'vault_create_folder: requires vault.access';
  END IF;
  IF length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'vault_create_folder: name is required';
  END IF;

  INSERT INTO public.vault_folders (name, is_personal, created_by)
  VALUES (trim(p_name), false, v_caller)
  RETURNING id INTO v_folder_id;

  INSERT INTO public.vault_folder_members
    (folder_id, staff_id, role, wrapped_folder_key, added_by)
  VALUES
    (v_folder_id, v_caller, 'owner', p_wrapped_folder_key, v_caller);

  PERFORM public.vault_log_event('create_folder', v_folder_id, NULL,
    jsonb_build_object('name', trim(p_name)));

  RETURN v_folder_id;
END;
$$;
