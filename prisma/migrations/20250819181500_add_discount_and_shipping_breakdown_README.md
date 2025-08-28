# Migration: Discount & Shipping Breakdown

Adds numeric columns to `public.order`:
- discount_amount (total discount in dollars)
- shipping_fee_gross (pre-discount shipping; currently same as net if shipping non-discountable)
- shipping_fee_net (post-discount shipping)

Existing shipping_fee column retained for backward compatibility (alias of net for now).
