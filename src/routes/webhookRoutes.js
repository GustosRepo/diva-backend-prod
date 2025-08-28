// /src/routes/webhookRoutes.js
import express from "express";
import { stripeWebhookHandler } from "../webhooks/stripeWebhook.js";

const router = express.Router();

// Raw body is applied in server.js for this mount path.
// Keeping it here too can break Stripe signature verification.
router.post("/", (req, res, next) => {
	console.log("[WEBHOOK ROUTE HIT] /api/webhooks/stripe (POST) content-type=", req.headers['content-type']);
	return stripeWebhookHandler(req, res, next);
});

// Simple GET to verify 200 from browser / curl
router.get("/", (req, res) => {
	res.status(200).json({ ok: true, path: "/api/webhooks/stripe", method: "GET" });
});

export default router;