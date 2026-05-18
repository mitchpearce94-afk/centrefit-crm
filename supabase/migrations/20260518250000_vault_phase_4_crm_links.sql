-- =============================================================================
-- Vault Phase 4 — CRM integration (2026-05-18)
-- =============================================================================
-- Lets a folder be associated with a site or customer record. The "Site
-- passwords" tab on /sites/[id] (and equivalent on /customers/[id]) reads
-- through this table.
--
-- A link does NOT grant access to the folder — that still goes through
-- vault_folder_members. The link just tells the UI "this site has X
-- folders associated; here are the names." If the viewer isn't a folder
-- member they see "you don't have access — ask an owner."
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.vault_folder_links (
  folder_id   UUID NOT NULL REFERENCES public.vault_folders(id) ON DELETE CASCADE,
  ref_type    TEXT NOT NULL CHECK (ref_type IN ('site', 'customer')),
  ref_id      UUID NOT NULL,
  linked_by   UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  linked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, ref_type, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_vault_folder_links_ref ON public.vault_folder_links(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_vault_folder_links_folder ON public.vault_folder_links(folder_id);

ALTER TABLE public.vault_folder_links ENABLE ROW LEVEL SECURITY;

-- A folder link is readable to:
--  - folder members (they need to see what this folder is attached to)
--  - anyone with access to the ref record (e.g. sites.view), so the
--    "Site passwords" tab can show counts even for staff who aren't yet
--    members of the linked folders
-- The latter is implemented via permission flag check (sites.view /
-- customers.view) because we can't easily SQL-join to the existing
-- per-record gates.
DROP POLICY IF EXISTS vault_folder_links_read ON public.vault_folder_links;
CREATE POLICY vault_folder_links_read ON public.vault_folder_links
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.vault_folder_members m
      WHERE m.folder_id = vault_folder_links.folder_id AND m.staff_id = auth.uid()
    )
    OR (vault_folder_links.ref_type = 'site' AND public.has_permission('sites.view'))
    OR (vault_folder_links.ref_type = 'customer' AND public.has_permission('customers.view'))
  );

-- Only folder owners can create/remove links (they're effectively granting
-- discoverability of the folder from a CRM record).
DROP POLICY IF EXISTS vault_folder_links_insert_owner ON public.vault_folder_links;
CREATE POLICY vault_folder_links_insert_owner ON public.vault_folder_links
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vault_folder_members m
      WHERE m.folder_id = vault_folder_links.folder_id
        AND m.staff_id  = auth.uid()
        AND m.role      = 'owner'
    )
  );

DROP POLICY IF EXISTS vault_folder_links_delete_owner ON public.vault_folder_links;
CREATE POLICY vault_folder_links_delete_owner ON public.vault_folder_links
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.vault_folder_members m
      WHERE m.folder_id = vault_folder_links.folder_id
        AND m.staff_id  = auth.uid()
        AND m.role      = 'owner'
    )
  );

-- ── helper: list folders linked to a ref (with caller-membership flag) ───
-- Returns one row per linked folder, with name + a `has_access` flag the
-- UI uses to render either an "Open in vault" link or a "Request access"
-- hint. Entry counts are deliberately NOT exposed to non-members (info
-- leak about content).

CREATE OR REPLACE FUNCTION public.vault_folders_for_ref(
  p_ref_type TEXT, p_ref_id UUID
) RETURNS TABLE (
  folder_id   UUID,
  folder_name TEXT,
  is_personal BOOLEAN,
  has_access  BOOLEAN,
  entry_count INT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'vault_folders_for_ref: not authenticated';
  END IF;
  IF p_ref_type NOT IN ('site', 'customer') THEN
    RAISE EXCEPTION 'vault_folders_for_ref: invalid ref_type %', p_ref_type;
  END IF;
  -- Gate by the corresponding view permission so non-CRM users can't
  -- enumerate folder links by ref_id.
  IF p_ref_type = 'site' AND NOT public.has_permission('sites.view') THEN
    RETURN;
  END IF;
  IF p_ref_type = 'customer' AND NOT public.has_permission('customers.view') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    f.id,
    f.name,
    f.is_personal,
    EXISTS (
      SELECT 1 FROM public.vault_folder_members m
      WHERE m.folder_id = f.id AND m.staff_id = v_caller
    ) AS has_access,
    (
      SELECT count(*)::INT FROM public.vault_entries e
      WHERE e.folder_id = f.id
        AND EXISTS (
          SELECT 1 FROM public.vault_folder_members m2
          WHERE m2.folder_id = f.id AND m2.staff_id = v_caller
        )
    ) AS entry_count
  FROM public.vault_folder_links l
  JOIN public.vault_folders f ON f.id = l.folder_id
  WHERE l.ref_type = p_ref_type AND l.ref_id = p_ref_id
  ORDER BY f.name;
END;
$$;
