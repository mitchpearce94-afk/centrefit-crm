-- Add 'accepted' to deal_stage enum
ALTER TYPE public.deal_stage ADD VALUE IF NOT EXISTS 'accepted';
