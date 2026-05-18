-- =============================================================================
-- Vault Phase 1 — Foundation + crypto + Personal folder (2026-05-18)
-- =============================================================================
-- Tables per docs/vault-CONTEXT.md D8. Zero-knowledge: server stores only
-- ciphertext + wrapped keys. RLS locks every row to its folder ACL.
--
-- Auth verification uses pgcrypto's bcrypt (cost 12, matches D2) — the
-- client PBKDF2-derives an auth_key from master password (600k iterations)
-- and the server stores crypt(auth_key, gen_salt('bf', 12)). Master
-- password never leaves the browser.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── vault_users ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vault_users (
  staff_id              UUID PRIMARY KEY REFERENCES public.staff(id) ON DELETE CASCADE,
  auth_key_hash         TEXT NOT NULL,           -- bcrypt of client-derived auth_key
  enc_salt              TEXT NOT NULL,           -- base64, PBKDF2 salt (client uses this to re-derive)
  wrapped_private_key   TEXT NOT NULL,           -- RSA private key, AES-GCM-wrapped with master-derived key
  wrapped_pk_iv         TEXT NOT NULL,           -- base64 IV for the wrapped private key
  recovery_wrapped_pk   TEXT,                    -- same private key, wrapped with recovery-code-derived key
  recovery_wrapped_iv   TEXT,                    -- IV for the recovery-wrapped version
  recovery_salt         TEXT,                    -- PBKDF2 salt for recovery code
  public_key            TEXT NOT NULL,           -- base64 SPKI RSA public key
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  vault_setup_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_unlock_at        TIMESTAMPTZ
);

ALTER TABLE public.vault_users ENABLE ROW LEVEL SECURITY;

-- A staff can read their own vault_users row (needed for unlock to fetch
-- salt + wrapped private key). Public keys of OTHER staff are needed when
-- sharing a folder (Phase 2) — handled by a separate vault_public_keys view
-- which we add at that time. For Phase 1 (single-user), self-only access is
-- sufficient.
DROP POLICY IF EXISTS vault_users_read_own ON public.vault_users;
CREATE POLICY vault_users_read_own ON public.vault_users
  FOR SELECT TO authenticated USING (staff_id = auth.uid());

-- All writes go through SECURITY DEFINER RPCs so we control exactly which
-- columns can be set (auth_key_hash must be bcrypted, not raw). Direct
-- writes denied.
DROP POLICY IF EXISTS vault_users_no_direct_write ON public.vault_users;
CREATE POLICY vault_users_no_direct_write ON public.vault_users
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ── vault_folders ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vault_folders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  description  TEXT,
  is_personal  BOOLEAN NOT NULL DEFAULT false,
  created_by   UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vault_folders_created_by ON public.vault_folders(created_by);

ALTER TABLE public.vault_folders ENABLE ROW LEVEL SECURITY;

-- A staff sees a folder iff they're a member (Phase 1: only themselves
-- on their Personal folder; Phase 2 extends this to shared folders).
DROP POLICY IF EXISTS vault_folders_read_member ON public.vault_folders;
CREATE POLICY vault_folders_read_member ON public.vault_folders
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.vault_folder_members m
      WHERE m.folder_id = vault_folders.id AND m.staff_id = auth.uid()
    )
  );

-- INSERT: only via setup_vault() or share helpers (Phase 2). Direct INSERT
-- allowed for the creator (used by createFolder action — checks vault.access
-- in app layer).
DROP POLICY IF EXISTS vault_folders_insert ON public.vault_folders;
CREATE POLICY vault_folders_insert ON public.vault_folders
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.has_permission('vault.access'));

-- UPDATE/DELETE: only folder owners (verified in app layer for Phase 1).
DROP POLICY IF EXISTS vault_folders_update_owner ON public.vault_folders;
CREATE POLICY vault_folders_update_owner ON public.vault_folders
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.vault_folder_members m
      WHERE m.folder_id = vault_folders.id AND m.staff_id = auth.uid() AND m.role = 'owner'
    )
  );

DROP POLICY IF EXISTS vault_folders_delete_owner ON public.vault_folders;
CREATE POLICY vault_folders_delete_owner ON public.vault_folders
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.vault_folder_members m
      WHERE m.folder_id = vault_folders.id AND m.staff_id = auth.uid() AND m.role = 'owner'
    )
  );

-- ── vault_folder_members ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vault_folder_members (
  folder_id            UUID NOT NULL REFERENCES public.vault_folders(id) ON DELETE CASCADE,
  staff_id             UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  role                 TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'owner')),
  wrapped_folder_key   TEXT NOT NULL,    -- folder key encrypted with this staff's public RSA key
  added_by             UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  added_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_vault_folder_members_staff ON public.vault_folder_members(staff_id);

ALTER TABLE public.vault_folder_members ENABLE ROW LEVEL SECURITY;

-- A staff sees their own memberships AND memberships in folders they own
-- (so owners can manage the member list in Phase 2). Phase 1 uses the
-- self-only branch.
DROP POLICY IF EXISTS vault_folder_members_read ON public.vault_folder_members;
CREATE POLICY vault_folder_members_read ON public.vault_folder_members
  FOR SELECT TO authenticated USING (
    staff_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.vault_folder_members m2
      WHERE m2.folder_id = vault_folder_members.folder_id
        AND m2.staff_id = auth.uid()
        AND m2.role = 'owner'
    )
  );

-- INSERT: a staff can add themselves with their own wrapped key (used by
-- setup_vault for the Personal folder). Adding OTHER staff is owner-only
-- and goes through the share_folder helper (Phase 2).
DROP POLICY IF EXISTS vault_folder_members_insert_self ON public.vault_folder_members;
CREATE POLICY vault_folder_members_insert_self ON public.vault_folder_members
  FOR INSERT TO authenticated
  WITH CHECK (
    staff_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.vault_folder_members m2
      WHERE m2.folder_id = vault_folder_members.folder_id
        AND m2.staff_id = auth.uid()
        AND m2.role = 'owner'
    )
  );

DROP POLICY IF EXISTS vault_folder_members_delete_owner ON public.vault_folder_members;
CREATE POLICY vault_folder_members_delete_owner ON public.vault_folder_members
  FOR DELETE TO authenticated USING (
    -- A staff can remove themselves (leave folder), or an owner can remove
    -- anyone (Phase 2 share management).
    staff_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.vault_folder_members m2
      WHERE m2.folder_id = vault_folder_members.folder_id
        AND m2.staff_id = auth.uid()
        AND m2.role = 'owner'
    )
  );

-- ── vault_entries ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vault_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id    UUID NOT NULL REFERENCES public.vault_folders(id) ON DELETE CASCADE,
  ciphertext   TEXT NOT NULL,             -- AES-GCM(JSON {title,url,username,password,notes,totp,custom})
  iv           TEXT NOT NULL,             -- base64 12-byte IV
  title_hint   TEXT,                      -- optional plaintext list-view aid (D9 caveat — opt-in)
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vault_entries_folder ON public.vault_entries(folder_id, updated_at DESC);

ALTER TABLE public.vault_entries ENABLE ROW LEVEL SECURITY;

-- A staff sees an entry iff they're a member of its folder.
DROP POLICY IF EXISTS vault_entries_read_member ON public.vault_entries;
CREATE POLICY vault_entries_read_member ON public.vault_entries
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.vault_folder_members m
      WHERE m.folder_id = vault_entries.folder_id AND m.staff_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE: editors and owners only.
DROP POLICY IF EXISTS vault_entries_insert_writer ON public.vault_entries;
CREATE POLICY vault_entries_insert_writer ON public.vault_entries
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vault_folder_members m
      WHERE m.folder_id = vault_entries.folder_id
        AND m.staff_id = auth.uid()
        AND m.role IN ('editor', 'owner')
    )
  );

DROP POLICY IF EXISTS vault_entries_update_writer ON public.vault_entries;
CREATE POLICY vault_entries_update_writer ON public.vault_entries
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.vault_folder_members m
      WHERE m.folder_id = vault_entries.folder_id
        AND m.staff_id = auth.uid()
        AND m.role IN ('editor', 'owner')
    )
  );

DROP POLICY IF EXISTS vault_entries_delete_writer ON public.vault_entries;
CREATE POLICY vault_entries_delete_writer ON public.vault_entries
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.vault_folder_members m
      WHERE m.folder_id = vault_entries.folder_id
        AND m.staff_id = auth.uid()
        AND m.role IN ('editor', 'owner')
    )
  );

-- ── vault_audit_log ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vault_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  action       TEXT NOT NULL CHECK (action IN (
    'setup', 'unlock', 'view_entry', 'create_entry', 'edit_entry',
    'delete_entry', 'share_folder', 'revoke_member', 'rotate_folder_key',
    'create_folder', 'delete_folder', 'recovery'
  )),
  folder_id    UUID,
  entry_id     UUID,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vault_audit_staff ON public.vault_audit_log(staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vault_audit_created ON public.vault_audit_log(created_at DESC);

ALTER TABLE public.vault_audit_log ENABLE ROW LEVEL SECURITY;

-- A staff sees their own audit rows; admins see all (D12).
DROP POLICY IF EXISTS vault_audit_read ON public.vault_audit_log;
CREATE POLICY vault_audit_read ON public.vault_audit_log
  FOR SELECT TO authenticated
  USING (staff_id = auth.uid() OR public.is_admin());

-- No direct writes — use vault_log_event() RPC.
DROP POLICY IF EXISTS vault_audit_no_direct_write ON public.vault_audit_log;
CREATE POLICY vault_audit_no_direct_write ON public.vault_audit_log
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- =============================================================================
-- Helper RPCs
-- =============================================================================

-- vault_log_event: append-only audit writer. staff_id is forced to auth.uid()
-- so it can't be forged.
CREATE OR REPLACE FUNCTION public.vault_log_event(
  p_action     TEXT,
  p_folder_id  UUID DEFAULT NULL,
  p_entry_id   UUID DEFAULT NULL,
  p_metadata   JSONB DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'vault_audit_log: not authenticated';
  END IF;
  INSERT INTO public.vault_audit_log (staff_id, action, folder_id, entry_id, metadata)
  VALUES (auth.uid(), p_action, p_folder_id, p_entry_id, p_metadata)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- setup_vault: one-shot setup ceremony.
--   client sends:
--     p_auth_key             — PBKDF2(master, salt, 600k), raw bytes base64-encoded
--     p_enc_salt             — base64 PBKDF2 salt used to derive auth_key + encryption_key
--     p_public_key           — base64 SPKI RSA public key
--     p_wrapped_private_key  — RSA private key, AES-GCM-wrapped with master-derived key
--     p_wrapped_pk_iv        — IV for above
--     p_recovery_wrapped_pk  — same private key, wrapped with recovery-code-derived key
--     p_recovery_wrapped_iv  — IV for above
--     p_recovery_salt        — base64 PBKDF2 salt for recovery code derivation
--     p_personal_folder_name — usually "Personal"
--     p_wrapped_folder_key   — Personal folder's symmetric key, wrapped with the user's public RSA key
-- Server: bcrypts the auth_key (cost 12), inserts vault_users + creates the
-- Personal folder + makes the user the owner with the wrapped folder key.
-- Idempotent on re-call: if vault_users row already exists, raises so the
-- client can prompt for unlock instead.
CREATE OR REPLACE FUNCTION public.setup_vault(
  p_auth_key              TEXT,
  p_enc_salt              TEXT,
  p_public_key            TEXT,
  p_wrapped_private_key   TEXT,
  p_wrapped_pk_iv         TEXT,
  p_recovery_wrapped_pk   TEXT,
  p_recovery_wrapped_iv   TEXT,
  p_recovery_salt         TEXT,
  p_personal_folder_name  TEXT,
  p_wrapped_folder_key    TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_staff_id UUID := auth.uid();
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
    recovery_wrapped_pk, recovery_wrapped_iv, recovery_salt, public_key
  ) VALUES (
    v_staff_id,
    crypt(p_auth_key, gen_salt('bf', 12)),
    p_enc_salt,
    p_wrapped_private_key,
    p_wrapped_pk_iv,
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

-- unlock_vault: verifies the client-supplied auth_key against the stored
-- bcrypt hash. On success, updates last_unlock_at and returns the
-- wrapped_private_key + iv + enc_salt + public_key so the client can decrypt
-- the private key with the master-derived encryption key. Caller is
-- responsible for then fetching folder memberships and unwrapping folder
-- keys with the now-decrypted private key.
CREATE OR REPLACE FUNCTION public.unlock_vault(p_auth_key TEXT)
RETURNS TABLE (
  ok                   BOOLEAN,
  enc_salt             TEXT,
  wrapped_private_key  TEXT,
  wrapped_pk_iv        TEXT,
  public_key           TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_staff_id UUID := auth.uid();
  v_row      public.vault_users%ROWTYPE;
BEGIN
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'unlock_vault: not authenticated';
  END IF;

  SELECT * INTO v_row FROM public.vault_users WHERE staff_id = v_staff_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF v_row.auth_key_hash <> crypt(p_auth_key, v_row.auth_key_hash) THEN
    -- Log the failure so we can spot brute-force later.
    PERFORM public.vault_log_event('unlock', NULL, NULL,
      jsonb_build_object('result', 'fail'));
    RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  UPDATE public.vault_users SET last_unlock_at = now() WHERE staff_id = v_staff_id;
  PERFORM public.vault_log_event('unlock', NULL, NULL,
    jsonb_build_object('result', 'ok'));

  RETURN QUERY SELECT true, v_row.enc_salt, v_row.wrapped_private_key,
                      v_row.wrapped_pk_iv, v_row.public_key;
END;
$$;

-- recover_vault: same as unlock but verified against the recovery code path,
-- and returns the recovery_wrapped_pk so the client can decrypt with the
-- recovery-derived key. After recovery, client is expected to re-setup the
-- master password (separate RPC, Phase 5).
-- (Phase 1 stub — implementation deferred to Phase 5 hardening.)

-- vault_can_view_folder: helper used in app code to quickly check
-- membership without re-querying. Mirrors RLS, useful for server actions.
CREATE OR REPLACE FUNCTION public.vault_can_view_folder(p_folder_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE v_id UUID := auth.uid();
BEGIN
  IF v_id IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.vault_folder_members
    WHERE folder_id = p_folder_id AND staff_id = v_id
  );
END;
$$;
