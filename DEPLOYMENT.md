DigitalOcean deployment notes

This backend is prepared to run on DigitalOcean App Platform or as a Docker container on a Droplet/Kubernetes.

Checklist before deploying

- Create a Supabase project and copy the SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY into DigitalOcean secret env vars.
- Create a Stripe account and set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. For Stripe webhooks you must point the webhook endpoint to the public HTTPS URL DigitalOcean provides (e.g. https://<app>-<hash>.ondigitalocean.app/api/webhooks/stripe).
- Set CLIENT_URL to your Vercel frontend URL (e.g. https://your-frontend.vercel.app).
- Provide Shippo and email credentials if you use shipping/email features.

Recommended DigitalOcean App Platform settings

- Build & Run: Use the provided Dockerfile. Port: 3001.
- Set environment variables via the DigitalOcean dashboard (do not commit secrets).
- Enable automatic deploys from GitHub if desired.

Important notes

- The webhook route expects the raw request body and must be mounted before json body parsing. DigitalOcean's load balancer preserves the body; ensure no middleware rewrites it.
- Use the provided /health endpoint for health checks.
- If you need file uploads persisted, mount or configure a persistent volume for the /uploads directory or adapt to use DO Spaces or Supabase storage.

Troubleshooting

- If Stripe signature verification fails, ensure STRIPE_WEBHOOK_SECRET matches the endpoint configured in the Stripe dashboard and that the endpoint path is exactly /api/webhooks/stripe.
- For background jobs or long operations, consider moving label purchases to a job queue.
