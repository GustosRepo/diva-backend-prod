-- Add Shippo / tracking related columns to order table (idempotent guards)
ALTER TABLE public."order"
  ADD COLUMN IF NOT EXISTS tracking_url text,
  ADD COLUMN IF NOT EXISTS label_url text,
  ADD COLUMN IF NOT EXISTS carrier text,
  ADD COLUMN IF NOT EXISTS service text,
  ADD COLUMN IF NOT EXISTS shippo_shipment_id text,
  ADD COLUMN IF NOT EXISTS shippo_rate_id text,
  ADD COLUMN IF NOT EXISTS shippo_transaction_id text;
