# Migration: Add Shippo Tracking / Label Fields

Adds columns to `public.order`:
- tracking_url
- label_url
- carrier
- service
- shippo_shipment_id
- shippo_rate_id
- shippo_transaction_id

All columns are nullable text for flexibility.

Apply (SQL example if not using prisma migrate):
```sql
ALTER TABLE public."order"
  ADD COLUMN IF NOT EXISTS tracking_url text,
  ADD COLUMN IF NOT EXISTS label_url text,
  ADD COLUMN IF NOT EXISTS carrier text,
  ADD COLUMN IF NOT EXISTS service text,
  ADD COLUMN IF NOT EXISTS shippo_shipment_id text,
  ADD COLUMN IF NOT EXISTS shippo_rate_id text,
  ADD COLUMN IF NOT EXISTS shippo_transaction_id text;
```

After applying, Stripe webhook will populate these when a label purchase succeeds.
