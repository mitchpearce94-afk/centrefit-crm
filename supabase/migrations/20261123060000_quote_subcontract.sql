-- Priced subcontractor scope on quotes (Mitchell, 23 Nov 2026 — Snap Fitness
-- Moffat Beach: Dane / DWP Electrical's lighting, power, data & TV and testing
-- carried on the Centrefit quote as a separate section with its own price).
-- Shape: { contractor, label, marginPercent, lines: [{ id, name, cost, sell }], inclusions }
-- Applied via the management API on 23 Nov 2026.
alter table public.quotes add column if not exists subcontract jsonb;
comment on column public.quotes.subcontract is 'Priced subcontractor scope carried on the quote (contractor, label, marginPercent, lines[{id,name,cost,sell}], inclusions). Rendered after Centrefit''s scope with its own total; added to the quote total outside uplift/discount/override. 23 Nov 2026.';
