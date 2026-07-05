-- document_activity.document_type CHECK only allowed quote/invoice/
-- recurring_plan, so 'plan' (in the TS DocumentType union since the plan
-- builder) and Phase B's 'monitoring_form' events were silently dropped —
-- logDocumentActivity deliberately swallows insert errors. Widen to match
-- the union in src/lib/activity/log.ts.
alter table document_activity drop constraint document_activity_document_type_check;
alter table document_activity add constraint document_activity_document_type_check
  check (document_type = any (array['quote'::text, 'invoice'::text, 'recurring_plan'::text, 'plan'::text, 'monitoring_form'::text]));
