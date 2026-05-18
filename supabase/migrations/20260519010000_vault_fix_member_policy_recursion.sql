-- =============================================================================
-- Vault hotfix — vault_folder_members policy recursion (2026-05-19)
-- =============================================================================
-- The Phase 1 policies on vault_folder_members referenced the same table in
-- their EXISTS subqueries to allow owners to see/manage other members'
-- rows. Postgres re-applies RLS to that inner subquery → infinite
-- recursion error on any direct SELECT/INSERT/DELETE.
--
-- Resolution: every cross-staff member operation in the app actually goes
-- through a SECURITY DEFINER RPC (vault_share_folder, vault_revoke_member,
-- vault_list_folder_members, vault_complete_rotation, setup_vault) which
-- bypasses RLS by design. The only direct table access from the client
-- is self-row read/insert/delete (createFolder inserts self as owner,
-- listFolders reads own membership row, leave-folder deletes self).
--
-- Therefore the table policies need only cover the self-row case. Owner
-- enforcement lives in the RPC bodies (`WHERE caller IS owner` check).
-- =============================================================================

DROP POLICY IF EXISTS vault_folder_members_read ON public.vault_folder_members;
CREATE POLICY vault_folder_members_read ON public.vault_folder_members
  FOR SELECT TO authenticated
  USING (staff_id = auth.uid());

DROP POLICY IF EXISTS vault_folder_members_insert_self ON public.vault_folder_members;
CREATE POLICY vault_folder_members_insert_self ON public.vault_folder_members
  FOR INSERT TO authenticated
  WITH CHECK (staff_id = auth.uid());

DROP POLICY IF EXISTS vault_folder_members_delete_owner ON public.vault_folder_members;
CREATE POLICY vault_folder_members_delete_owner ON public.vault_folder_members
  FOR DELETE TO authenticated
  USING (staff_id = auth.uid());
