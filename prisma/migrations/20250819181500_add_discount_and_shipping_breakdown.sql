-- Add discount + shipping breakdown columns (idempotent)
ALTER TABLE public."order"
  ADD COLUMN IF NOT EXISTS discount_amount numeric,
  ADD COLUMN IF NOT EXISTS shipping_fee_gross numeric,
  ADD COLUMN IF NOT EXISTS shipping_fee_net numeric;
