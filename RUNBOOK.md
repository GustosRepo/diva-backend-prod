Runbook: Launch, Monitor, Rollback

Overview
- Backend provides Stripe checkout, Local Pickup (pay on pickup), Shippo rates/labels, and admin endpoints.
- Supabase is the database; no migrations required for pickup (uses JSON shipping_info).

Environment
- Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET
- Stripe: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
- CORS/Frontend: CLIENT_URL
- Shipping: SHIPPO_API_KEY, SHIP_FROM_* (name, email, phone, address fields)
- Email: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
- Misc: ADMIN_EMAIL, PORT=3001, NODE_ENV=production

Deploy (DigitalOcean App Platform)
- Build/Run: container port 3001; use existing Dockerfile
- Set all env vars in DO dashboard (never commit secrets)
- Route exposure: public service
- Health check: GET /health (expect { ok: true })

Stripe Webhook
- Configure Stripe endpoint: https://<your-app>.ondigitalocean.app/api/webhooks/stripe
- Use STRIPE_WEBHOOK_SECRET from Stripe dashboard
- Must see 2xx on delivery; signature verification uses express.raw

Smoke Tests (prod)
- Health: curl -f https://api/health
- Rates: POST /checkout/shippo-rate with { shippingInfo, items } → returns fee
- Pickup: POST /orders/pickup (auth) → 201 with order_id; inventory decremented
- Stripe: create a small test order with test key → webhook inserts order
- Tracking: GET /orders/track?orderId=...&email=...

Admin Actions
- Mark paid: PATCH /orders/:id/mark-paid (auth: admin)
- Mark picked up: PATCH /orders/:id/mark-picked-up (auth: admin)
- Cancel (restock): PATCH /orders/:id/cancel (auth: admin)

Scheduled Cleanup
- Endpoint: POST /orders/admin/cancel-expired-pickups (auth: admin)
- Script: backend/scripts/cancel-expired-pickups.mjs
- DO command: API_BASE_URL=https://api ADMIN_JWT=<token> npm run cron:cancel-expired-pickups
- Suggested cadence: every 15–30 minutes

Observability
- Logs are reduced in production. Errors still log to stdout. Use DO App logs.
- Consider adding request ID headers and JSON logging later.

Rollback
- If Stripe webhook fails: confirm STRIPE_WEBHOOK_SECRET and endpoint path; roll back to last working image
- If email fails: verify Gmail OAuth tokens; system continues without blocking
- If shipping rate fails: endpoint returns 4xx/5xx; frontend shows $0; investigate SHIPPO_API_KEY

Emergency Ops
- Manually cancel an order: PATCH /orders/:id/cancel (admin)
- Restock: handled automatically on cancel/expiry; or adjust via product controller/admin tool

