-- Migrate any existing deals on removed stages to sensible defaults
UPDATE public.pipeline_deals SET stage = 'lead' WHERE stage = 'qualified';
UPDATE public.pipeline_deals SET stage = 'lead' WHERE stage = 'negotiating';
UPDATE public.pipeline_deals SET stage = 'accepted' WHERE stage = 'won';
