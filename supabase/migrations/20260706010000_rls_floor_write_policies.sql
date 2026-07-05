-- RLS floor (Phase E of permissions-CONTEXT.md, executed 2026-07-06).
-- Every always-true WRITE policy flagged by the security advisor is
-- replaced with the permission flag the app already enforces (D4/D8
-- matrix) via has_permission() — SECURITY DEFINER, admin always passes,
-- then per-staff overrides, then role defaults. SELECT policies stay
-- deliberately open per D7 (all staff see customers/sites; $ hiding is
-- app-level D2). Service-role writes (webhooks, crons, public token
-- routes) bypass RLS and are unaffected. document_activity INSERT stays
-- open by design: it's an append-only log every staff action writes to.

drop policy "contacts_insert" on customer_contacts;
create policy "contacts_insert" on customer_contacts for insert to authenticated with check (has_permission('sites.manage_contacts'));

drop policy "contacts_update" on customer_contacts;
create policy "contacts_update" on customer_contacts for update to authenticated using (has_permission('sites.manage_contacts')) with check (has_permission('sites.manage_contacts'));

drop policy "sites_insert" on customer_sites;
create policy "sites_insert" on customer_sites for insert to authenticated with check (has_permission('sites.edit_basic'));

drop policy "sites_update" on customer_sites;
create policy "sites_update" on customer_sites for update to authenticated using (has_permission('sites.edit_basic')) with check (has_permission('sites.edit_basic'));

drop policy "customers_insert" on customers;
create policy "customers_insert" on customers for insert to authenticated with check (has_permission('customers.create'));

drop policy "customers_update" on customers;
create policy "customers_update" on customers for update to authenticated using (has_permission('customers.edit_basic')) with check (has_permission('customers.edit_basic'));

drop policy "sign_requests_insert" on document_sign_requests;
create policy "sign_requests_insert" on document_sign_requests for insert to authenticated with check (has_permission('jobs.manage'));

drop policy "invoices_insert" on invoices;
create policy "invoices_insert" on invoices for insert to authenticated with check (has_permission('invoices.send'));

drop policy "invoices_update" on invoices;
create policy "invoices_update" on invoices for update to authenticated using (has_permission('invoices.send')) with check (has_permission('invoices.send'));

drop policy "job_checklist_insert" on job_checklist_items;
create policy "job_checklist_insert" on job_checklist_items for insert to authenticated with check (has_permission('jobs.update_status'));

drop policy "job_checklist_update" on job_checklist_items;
create policy "job_checklist_update" on job_checklist_items for update to authenticated using (has_permission('jobs.update_status')) with check (has_permission('jobs.update_status'));

drop policy "job_notes_insert" on job_notes;
create policy "job_notes_insert" on job_notes for insert to authenticated with check (has_permission('jobs.update_status'));

drop policy "job_notes_update" on job_notes;
create policy "job_notes_update" on job_notes for update to authenticated using (has_permission('jobs.update_status')) with check (has_permission('jobs.update_status'));

drop policy "job_procurement_items_authed_all" on job_procurement_items;
create policy "job_procurement_items_authed_all" on job_procurement_items for all to authenticated using (has_permission('procurement.manage') OR has_permission('procurement.receive')) with check (has_permission('procurement.manage') OR has_permission('procurement.receive'));

drop policy "job_staff_delete" on job_staff;
create policy "job_staff_delete" on job_staff for delete to authenticated using (has_permission('jobs.assign_others'));

drop policy "job_staff_insert" on job_staff;
create policy "job_staff_insert" on job_staff for insert to authenticated with check (has_permission('jobs.assign_others'));

drop policy "job_staff_update" on job_staff;
create policy "job_staff_update" on job_staff for update to authenticated using (has_permission('jobs.assign_others')) with check (has_permission('jobs.assign_others'));

drop policy "job_time_insert" on job_time;
create policy "job_time_insert" on job_time for insert to authenticated with check (has_permission('jobs.update_status'));

drop policy "Authenticated users can manage job updates" on job_updates;
create policy "Authenticated users can manage job updates" on job_updates for all to authenticated using (has_permission('jobs.update_status')) with check (has_permission('jobs.update_status'));

drop policy "work_entries_insert" on job_work_entries;
create policy "work_entries_insert" on job_work_entries for insert to authenticated with check (has_permission('jobs.update_status'));

drop policy "jobs_insert" on jobs;
create policy "jobs_insert" on jobs for insert to authenticated with check (has_permission('jobs.manage'));

drop policy "jobs_update" on jobs;
create policy "jobs_update" on jobs for update to authenticated using (has_permission('jobs.update_status')) with check (has_permission('jobs.update_status'));

drop policy "nbn_enquiries_authed_all" on nbn_enquiries;
create policy "nbn_enquiries_authed_all" on nbn_enquiries for all to authenticated using (has_permission('nbn.manage')) with check (has_permission('nbn.manage'));

drop policy "nbn_steps_insert" on nbn_steps;
create policy "nbn_steps_insert" on nbn_steps for insert to authenticated with check (has_permission('nbn.manage'));

drop policy "nbn_steps_update" on nbn_steps;
create policy "nbn_steps_update" on nbn_steps for update to authenticated using (has_permission('nbn.manage')) with check (has_permission('nbn.manage'));

drop policy "parts_insert" on parts;
create policy "parts_insert" on parts for insert to authenticated with check (has_permission('settings.products'));

drop policy "parts_update" on parts;
create policy "parts_update" on parts for update to authenticated using (has_permission('settings.products')) with check (has_permission('settings.products'));

drop policy "pipeline_deals_insert" on pipeline_deals;
create policy "pipeline_deals_insert" on pipeline_deals for insert to authenticated with check (has_permission('quoting.create'));

drop policy "pipeline_deals_update" on pipeline_deals;
create policy "pipeline_deals_update" on pipeline_deals for update to authenticated using (has_permission('quoting.create')) with check (has_permission('quoting.create'));

drop policy "Authenticated users can manage plan files" on plan_files;
create policy "Authenticated users can manage plan files" on plan_files for all to authenticated using (has_permission('plans.manage')) with check (has_permission('plans.manage'));

drop policy "quote_dependency_rules_insert" on quote_dependency_rules;
create policy "quote_dependency_rules_insert" on quote_dependency_rules for insert to authenticated with check (has_permission('settings.products'));

drop policy "quote_dependency_rules_update" on quote_dependency_rules;
create policy "quote_dependency_rules_update" on quote_dependency_rules for update to authenticated using (has_permission('settings.products')) with check (has_permission('settings.products'));

drop policy "quote_extras_delete" on quote_extras;
create policy "quote_extras_delete" on quote_extras for delete to authenticated using (has_permission('quoting.create'));

drop policy "quote_extras_insert" on quote_extras;
create policy "quote_extras_insert" on quote_extras for insert to authenticated with check (has_permission('quoting.create'));

drop policy "quote_extras_update" on quote_extras;
create policy "quote_extras_update" on quote_extras for update to authenticated using (has_permission('quoting.create')) with check (has_permission('quoting.create'));

drop policy "quote_line_items_delete" on quote_line_items;
create policy "quote_line_items_delete" on quote_line_items for delete to authenticated using (has_permission('quoting.create'));

drop policy "quote_line_items_insert" on quote_line_items;
create policy "quote_line_items_insert" on quote_line_items for insert to authenticated with check (has_permission('quoting.create'));

drop policy "quote_line_items_update" on quote_line_items;
create policy "quote_line_items_update" on quote_line_items for update to authenticated using (has_permission('quoting.create')) with check (has_permission('quoting.create'));

drop policy "quote_rule_templates_insert" on quote_rule_templates;
create policy "quote_rule_templates_insert" on quote_rule_templates for insert to authenticated with check (has_permission('settings.products'));

drop policy "quote_rule_templates_update" on quote_rule_templates;
create policy "quote_rule_templates_update" on quote_rule_templates for update to authenticated using (has_permission('settings.products')) with check (has_permission('settings.products'));

drop policy "quotes_insert" on quotes;
create policy "quotes_insert" on quotes for insert to authenticated with check (has_permission('quoting.create'));

drop policy "quotes_update" on quotes;
create policy "quotes_update" on quotes for update to authenticated using (has_permission('quoting.create')) with check (has_permission('quoting.create'));

drop policy "recurring_plan_items_insert" on recurring_plan_items;
create policy "recurring_plan_items_insert" on recurring_plan_items for insert to authenticated with check (has_permission('invoices.manage_recurring'));

drop policy "recurring_plan_items_update" on recurring_plan_items;
create policy "recurring_plan_items_update" on recurring_plan_items for update to authenticated using (has_permission('invoices.manage_recurring')) with check (has_permission('invoices.manage_recurring'));

drop policy "recurring_plans_insert" on recurring_plans;
create policy "recurring_plans_insert" on recurring_plans for insert to authenticated with check (has_permission('invoices.manage_recurring'));

drop policy "recurring_plans_update" on recurring_plans;
create policy "recurring_plans_update" on recurring_plans for update to authenticated using (has_permission('invoices.manage_recurring')) with check (has_permission('invoices.manage_recurring'));

drop policy "schedule_entries_insert" on schedule_entries;
create policy "schedule_entries_insert" on schedule_entries for insert to authenticated with check (has_permission('scheduler.manage'));

drop policy "schedule_entries_update" on schedule_entries;
create policy "schedule_entries_update" on schedule_entries for update to authenticated using (has_permission('scheduler.manage')) with check (has_permission('scheduler.manage'));

drop policy "site_assets_insert" on site_assets;
create policy "site_assets_insert" on site_assets for insert to authenticated with check (has_permission('sites.manage_assets'));

drop policy "site_assets_update" on site_assets;
create policy "site_assets_update" on site_assets for update to authenticated using (has_permission('sites.manage_assets')) with check (has_permission('sites.manage_assets'));

drop policy "site_documents_insert" on site_documents;
create policy "site_documents_insert" on site_documents for insert to authenticated with check (has_permission('sites.edit_basic'));

drop policy "skip_delete" on site_key_info_photos;
create policy "skip_delete" on site_key_info_photos for delete to authenticated using (has_permission('sites.edit_key_info'));

drop policy "skip_insert" on site_key_info_photos;
create policy "skip_insert" on site_key_info_photos for insert to authenticated with check (has_permission('sites.edit_key_info'));

drop policy "skip_update" on site_key_info_photos;
create policy "skip_update" on site_key_info_photos for update to authenticated using (has_permission('sites.edit_key_info')) with check (has_permission('sites.edit_key_info'));

drop policy "staff write state_electricians" on state_electricians;
create policy "staff write state_electricians" on state_electricians for all to authenticated using (has_permission('settings.electricians')) with check (has_permission('settings.electricians'));

drop policy "suppliers_insert" on suppliers;
create policy "suppliers_insert" on suppliers for insert to authenticated with check (has_permission('suppliers.manage'));

drop policy "suppliers_update" on suppliers;
create policy "suppliers_update" on suppliers for update to authenticated using (has_permission('suppliers.manage')) with check (has_permission('suppliers.manage'));
