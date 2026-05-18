-- =============================================================================
-- Vault Phase 5a — Recovery flow (2026-05-18)
-- =============================================================================
-- Adds the verifier needed to prove a caller knows the recovery code, plus
-- the RPCs to (1) fetch the recovery-wrapped private key and (2) atomically
-- reset master-password credentials.
--
-- Design rationale: without a server-side recovery verifier, an authenticated
-- attacker could overwrite their own vault_users row with garbage credentials
-- and self-DoS. With a bcrypted recovery_auth_key, the server can refuse the
-- reset unless the caller proves recovery-code knowledge.
-- =============================================================================

-- 1. Schema additions ----------------------------------------------------

ALTER TABLE public.vault_users
  ADD COLUMN IF NOT EXISTS recovery_auth_key_hash TEXT;

-- 2. setup_vault — extended signature with the recovery verifier --------
-- New required arg `p_recovery_auth_key` is bcrypted server-side.
-- Replaces the Phase 1 signature.

DROP FUNCTION IF EXISTS public.setup_vault(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.setup_vault(
  p_auth_key              TEXT,
  p_enc_salt              TEXT,
  p_public_key            TEXT,
  p_wrapped_private_key   TEXT,
  p_wrapped_pk_iv         TEXT,
  p_recovery_auth_key     TEXT,   -- NEW: PBKDF2(recovery_code, recovery_salt, 600k)
  p_recovery_wrapped_pk   TEXT,
  p_recovery_wrapped_iv   TEXT,
  p_recovery_salt         TEXT,
  p_personal_folder_name  TEXT,
  p_wrapped_folder_key    TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_staff_id  UUID := auth.uid();
  v_folder_id UUID;
BEGIN
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'setup_vault: not authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vault_users WHERE staff_id = v_staff_id) THEN
    RAISE EXCEPTION 'setup_vault: vault already initialised for this staff';
  END IF;

  INSERT INTO public.vault_users (
    staff_id, auth_key_hash, enc_salt, wrapped_private_key, wrapped_pk_iv,
    recovery_auth_key_hash,
    recovery_wrapped_pk, recovery_wrapped_iv, recovery_salt, public_key
  ) VALUES (
    v_staff_id,
    crypt(p_auth_key, gen_salt('bf', 12)),
    p_enc_salt,
    p_wrapped_private_key,
    p_wrapped_pk_iv,
    crypt(p_recovery_auth_key, gen_salt('bf', 12)),
    p_recovery_wrapped_pk,
    p_recovery_wrapped_iv,
    p_recovery_salt,
    p_public_key
  );

  INSERT INTO public.vault_folders (name, is_personal, created_by)
  VALUES (p_personal_folder_name, true, v_staff_id)
  RETURNING id INTO v_folder_id;

  INSERT INTO public.vault_folder_members (folder_id, staff_id, role, wrapped_folder_key, added_by)
  VALUES (v_folder_id, v_staff_id, 'owner', p_wrapped_folder_key, v_staff_id);

  PERFORM public.vault_log_event('setup', v_folder_id, NULL,
    jsonb_build_object('personal_folder', v_folder_id));

  RETURN v_folder_id;
END;
$$;

-- 3. recover_vault — verifier + return wrapped blob for decryption -------

CREATE OR REPLACE FUNCTION public.recover_vault(p_recovery_auth_key TEXT)
RETURNS TABLE (
  ok                   BOOLEAN,
  recovery_salt        TEXT,
  recovery_wrapped_pk  TEXT,
  recovery_wrapped_iv  TEXT,
  public_key           TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_staff_id UUID := auth.uid();
  v_row      public.vault_users%ROWTYPE;
BEGIN
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'recover_vault: not authenticated';
  END IF;

  SELECT * INTO v_row FROM public.vault_users WHERE staff_id = v_staff_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;
  IF v_row.recovery_auth_key_hash IS NULL THEN
    -- Legacy vault from before Phase 5a — can't recover via this path.
    PERFORM public.vault_log_event('recovery', NULL, NULL,
      jsonb_build_object('result', 'legacy_no_recovery_verifier'));
    RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;
  IF v_row.recovery_auth_key_hash <> crypt(p_recovery_auth_key, v_row.recovery_auth_key_hash) THEN
    PERFORM public.vault_log_event('recovery', NULL, NULL,
      jsonb_build_object('result', 'fail'));
    RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  PERFORM public.vault_log_event('recovery', NULL, NULL,
    jsonb_build_object('result', 'ok'));
  RETURN QUERY SELECT true, v_row.recovery_salt, v_row.recovery_wrapped_pk,
                      v_row.recovery_wrapped_iv, v_row.public_key;
END;
$$;

-- 4. reset_master_credentials — re-verifies recovery + atomically swaps --
--    master-password-derived artifacts. Recovery code itself does not change
--    (no new recovery_* args; user keeps the same printed recovery code).

CREATE OR REPLACE FUNCTION public.reset_master_credentials(
  p_recovery_auth_key       TEXT,
  p_new_auth_key            TEXT,
  p_new_enc_salt            TEXT,
  p_new_wrapped_private_key TEXT,
  p_new_wrapped_pk_iv       TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_staff_id UUID := auth.uid();
  v_row      public.vault_users%ROWTYPE;
BEGIN
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'reset_master_credentials: not authenticated';
  END IF;
  SELECT * INTO v_row FROM public.vault_users WHERE staff_id = v_staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reset_master_credentials: no vault for this staff';
  END IF;
  IF v_row.recovery_auth_key_hash IS NULL
     OR v_row.recovery_auth_key_hash <> crypt(p_recovery_auth_key, v_row.recovery_auth_key_hash)
  THEN
    PERFORM public.vault_log_event('recovery', NULL, NULL,
      jsonb_build_object('result', 'reset_denied_bad_recovery_key'));
    RAISE EXCEPTION 'reset_master_credentials: recovery verification failed';
  END IF;

  UPDATE public.vault_users SET
    auth_key_hash       = crypt(p_new_auth_key, gen_salt('bf', 12)),
    enc_salt            = p_new_enc_salt,
    wrapped_private_key = p_new_wrapped_private_key,
    wrapped_pk_iv       = p_new_wrapped_pk_iv,
    last_unlock_at      = now()
   WHERE staff_id = v_staff_id;

  PERFORM public.vault_log_event('recovery', NULL, NULL,
    jsonb_build_object('result', 'master_reset_ok'));
  RETURN true;
END;
$$;
