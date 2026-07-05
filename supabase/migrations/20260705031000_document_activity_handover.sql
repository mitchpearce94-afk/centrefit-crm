-- Phase D: handover acceptance events on the activity timeline. Keep this
-- CHECK in lockstep with the DocumentType union in src/lib/activity/log.ts
-- — logDocumentActivity swallows insert errors, so a missing value here
-- drops events silently (see 20260705021500).
alter table document_activity drop constraint document_activity_document_type_check;
alter table document_activity add constraint document_activity_document_type_check
  check (document_type = any (array['quote'::text, 'invoice'::text, 'recurring_plan'::text, 'plan'::text, 'monitoring_form'::text, 'handover'::text]));
