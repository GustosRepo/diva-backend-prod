import express from "express";
import Stripe from "stripe";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import supabase from "../../supabaseClient.js";
import { shippoClient } from "../shippoClient.js";
import { getCheapestShippoRate } from "./shippingQuote.js";


dotenv.config();
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2022-11-15",
});
// Safe frontend base URL fallback
const BASE_CLIENT_URL = process.env.CLIENT_URL || process.env.FRONTEND_URL || "http://localhost:3000";


// 🔐 Decode user from JWT (if logged in)
const getUserFromToken = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("🔐 Decoded user from token:", decoded);
    return decoded;
  } catch (err) {
    console.error("❌ Invalid token", err);
    return null;
  }
};

router.post("/create-checkout-session", async (req, res) => {
  try {
    console.log("🛠 Incoming Checkout Data:", req.body);

  const { items, shippingInfo, metadata: clientMetadata, shippoShipmentId, shippoRateId, isLocalPickup, isLocal } = req.body;
    const user = getUserFromToken(req);

    // Per-request promo code container (avoid cross-request leakage)
    let promoCodeId = null;

    // 🧮 If user has 100+ points, generate/ensure a single-use promo
    if (user && user.userId && user.userId !== "guest") {
      try {
        const { data: dbUser, error: userError } = await supabase
          .from("user")
          .select("id, points")
          .eq("id", user.userId)
          .single();
        if (userError) throw userError;
        if (dbUser && (dbUser.points || 0) >= 100) {
          const couponCode = `DIVA-${user.userId.slice(0, 6).toUpperCase()}`;
          // Look up an existing active promotion code with this code
            const existing = await stripe.promotionCodes.list({ code: couponCode, limit: 1 });
            const activePromo = existing.data.find(p => p.code === couponCode && p.active && !p.restrictions?.ends_at);
            if (activePromo) {
              promoCodeId = activePromo.id;
              console.log("🎟️ Reusing active promo code:", couponCode);
            } else {
              const coupon = await stripe.coupons.create({ percent_off: 10, duration: "once" });
              const promo = await stripe.promotionCodes.create({ code: couponCode, coupon: coupon.id, max_redemptions: 1 });
              promoCodeId = promo.id;
              const { error: updateError } = await supabase
                .from("user")
                .update({ points: (dbUser.points || 0) - 100 })
                .eq("id", user.userId);
              if (updateError) throw updateError;
              console.log("🎁 Created new promo & deducted 100 points:", couponCode);
            }
        }
      } catch (e) {
        console.error("❌ Promo code generation error (non-fatal):", e?.message || e);
      }
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "No items provided" });
    }

    const productLineItems = items.map((item) => ({
      price_data: {
        currency: "usd",
        product_data: {
          name: item.title || item.name || "Item",
          images: [
            item.image?.startsWith("http")
              ? item.image
              : `${BASE_CLIENT_URL}${item.image}`,
          ].filter(Boolean),
        },
        unit_amount: Math.round(Number(item.price) * 100),
        tax_behavior: "exclusive",
      },
      quantity: Number(item.quantity) || 1,
    }));

    // If client provided shipment + selected rate, fetch shipment to validate & extract rate
    let selectedRate = null;
    let effectiveShipmentId = shippoShipmentId;

    // If local pickup, shipping is $0
    let shippingCents = 0;
    if (isLocalPickup || isLocal) {
      selectedRate = {
        id: "local-pickup",
        provider: "Local Pickup",
        service: "Pickup",
        amount: 0,
        currency: "USD",
      };
      effectiveShipmentId = null;
    } else {
      if (shippoShipmentId && shippoRateId) {
        try {
          const shipment = await shippoClient.shipments.retrieve(shippoShipmentId);
          const rate = (shipment?.rates || []).find(r => r.objectId === shippoRateId);
          if (!rate) return res.status(400).json({ message: "Provided Shippo rate not found in shipment" });
          selectedRate = {
            id: rate.objectId,
            provider: rate.provider,
            service: rate.servicelevel?.name || rate.servicelevel?.token || "Service",
            amount: Number(rate.amount),
            currency: rate.currency || "USD",
          };
        } catch (e) {
          console.error("❌ Failed to validate provided Shippo shipment/rate:", e?.message || e);
          return res.status(400).json({ message: "Invalid Shippo shipment/rate" });
        }
      }
      // If not provided, compute cheapest now
      if (!selectedRate) {
        if (!shippingInfo) return res.status(400).json({ message: "shippingInfo required when shipment not pre-created" });
        try {
          const { cheapest, shipment } = await getCheapestShippoRate({ shippingInfo, items });
          selectedRate = cheapest;
          effectiveShipmentId = shipment?.objectId;
        } catch (e) {
          console.error("❌ Shippo rate error:", e?.message || e);
          return res.status(502).json({ message: "Failed to obtain shipping rate" });
        }
      }
      shippingCents = Math.round(Number(selectedRate.amount) * 100);
    }

    // Build product line items only (exclude shipping from line_items)
    const lineItems = [
      ...productLineItems
    ];

    // NEW: Compact items for metadata (Stripe value limit 500 chars per field)
    let compactItems = items.map(it => ({
      id: it.id,
      q: Number(it.quantity || 1),
      p: Math.round(Number(it.price) * 100), // cents
    }));
    let itemsJson = JSON.stringify(compactItems);
    if (itemsJson.length > 500) {
      // Drop price first
      compactItems = items.map(it => ({ id: it.id, q: Number(it.quantity || 1) }));
      itemsJson = JSON.stringify(compactItems);
    }
    if (itemsJson.length > 500) {
      // As last resort truncate (still valid JSON by slicing array entries)
      while (itemsJson.length > 500 && compactItems.length > 0) {
        compactItems.pop();
        itemsJson = JSON.stringify(compactItems);
      }
    }

    const sessionMetadata = {
      userId: user?.userId || "guest",
      email: user?.email || "guest@example.com",
      items: itemsJson, // compact representation
      subtotal: String(
        Math.round(
          items.reduce(
            (acc, item) => acc + Number(item.price) * Number(item.quantity || 1),
            0
          ) * 100
        )
      ),
      shippingInfo: shippingInfo ? JSON.stringify(shippingInfo) : "",
      shipping_fee: String(shippingCents),
      shippo_shipment_id: effectiveShipmentId || "",
      shippo_rate_id: selectedRate.id || "",
      shipping_rate_provider: selectedRate.provider || "",
      shipping_rate_service: selectedRate.service || "",
      ship_from_email: process.env.SHIP_FROM_EMAIL || "",
      ship_from_phone: process.env.SHIP_FROM_PHONE || "",
      ...(clientMetadata || {}),
    };

    const baseSessionPayload = {
      payment_method_types: ["card"],
      line_items: [...productLineItems],
      mode: "payment",
      success_url: `${BASE_CLIENT_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_CLIENT_URL}/checkout/cancel`,
      metadata: sessionMetadata,
      customer_email: user?.email || undefined,
      shipping_address_collection: { allowed_countries: ["US", "CA"] },
      automatic_tax: { enabled: true },
      shipping_options: [
        {
          shipping_rate_data: {
            display_name: `${selectedRate.provider} - ${selectedRate.service}`.trim(),
            type: "fixed_amount",
            fixed_amount: { amount: shippingCents, currency: (selectedRate.currency || "USD").toLowerCase() },
            tax_behavior: "exclusive",
          },
        },
      ],
    };

    // Attempt creation with discount if present, retry once w/o on coupon errors
    let session;
    if (promoCodeId) {
      try {
        session = await stripe.checkout.sessions.create({
          ...baseSessionPayload,
          discounts: [{ promotion_code: promoCodeId }],
        });
        console.log("✅ Stripe session created with promo:", session.id);
      } catch (err) {
        const code = err?.code || err?.raw?.code;
        if (code === "coupon_expired" || code === "resource_missing" || code === "invalid_request_error") {
          console.warn(`⚠️ Promo code invalid (${code}). Retrying without discount.`);
          try {
            session = await stripe.checkout.sessions.create(baseSessionPayload);
            console.log("✅ Stripe session created without promo after retry:", session.id);
          } catch (retryErr) {
            console.error("❌ Stripe retry failed:", retryErr);
            return res.status(500).json({ message: "Failed to create checkout session", error: retryErr.message });
          }
        } else {
          console.error("❌ Stripe session creation failed (non-coupon error):", err);
          return res.status(500).json({ message: "Failed to create checkout session", error: err.message });
        }
      }
    } else {
      session = await stripe.checkout.sessions.create(baseSessionPayload);
      console.log("✅ Stripe session created (no promo):", session.id);
    }

    return res.json({ url: session.url, shipping: selectedRate, shippoShipmentId: effectiveShipmentId });
  } catch (error) {
    console.error("❌ Stripe Checkout Error (outer catch):", error);
    return res.status(500).json({ message: "Failed to create checkout session", error: error.message });
  }
});

// Replaced /shippo-rate route handler
router.post("/shippo-rate", async (req, res) => {
  const { shippingInfo, items } = req.body || {};
  if (!shippingInfo || !items) {
    return res.status(400).json({ message: "shippingInfo and items required" });
  }
  try {
    const start = Date.now();
    const { cheapest, rates } = await getCheapestShippoRate({ shippingInfo, items });
    const ms = Date.now() - start;
    return res.json({
      success: true,
      shipping_fee: Number(cheapest.amount),
      shipping_fee_cents: Math.round(Number(cheapest.amount) * 100),
      rate: cheapest,
      rates,
      elapsed_ms: ms,
    });
  } catch (e) {
    console.error("❌ /shippo-rate error:", e?.message || e);
    return res.status(502).json({ message: "Failed to obtain Shippo rates", error: e?.message || String(e) });
  }
});

// 📦 Backwards-compatible endpoint for legacy clients still calling /goshipoo-rate
router.post("/goshipoo-rate", async (req, res) => {
  const { shippingInfo, items } = req.body || {};
  if (!shippingInfo || !items) {
    return res.status(400).json({ message: "shippingInfo and items required" });
  }
  try {
    const start = Date.now();
    const { cheapest, rates } = await getCheapestShippoRate({ shippingInfo, items });
    const ms = Date.now() - start;
    return res.json({
      success: true,
      shipping_fee: Number(cheapest.amount),
      shipping_fee_cents: Math.round(Number(cheapest.amount) * 100),
      rate: cheapest,
      rates,
      elapsed_ms: ms,
    });
  } catch (e) {
    console.error("❌ /goshipoo-rate error:", e?.message || e);
    return res.status(502).json({ message: "Failed to obtain Shippo rates", error: e?.message || String(e) });
  }
});

// ✅ New route to finalize points AFTER redirect (unchanged)
router.post("/finalize-points", async (req, res) => {
  const { sessionId } = req.body;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const userId = session.metadata?.userId;
    const totalAmount = session.amount_total / 100;
    const appliedPromoCode = session.total_details?.breakdown?.discounts?.[0]?.promotion_code;
    const expectedPromoCode = `DIVA-${userId.slice(0, 6).toUpperCase()}`;
    const usedDiscount = appliedPromoCode === expectedPromoCode;
    const pointsEarned = Math.floor(totalAmount);

    console.log("🔍 Finalizing points...");
    console.log("👤 userId:", userId);
    console.log("💸 totalAmount:", totalAmount);
    console.log("💰 pointsEarned:", pointsEarned);

    if (!userId || userId === "guest") {
      return res.status(200).json({ message: "Guest checkout – no points updated." });
    }

    const { data: userRec, error: userError } = await supabase
      .from("user")
      .select("*")
      .eq("id", userId)
      .single();
    if (userError) throw userError;
    if (!userRec) return res.status(404).json({ message: "User not found" });

    const newPoints = Math.max(0, (userRec.points || 0) + pointsEarned - (usedDiscount ? 100 : 0));

    const { error: updateError } = await supabase
      .from("user")
      .update({ points: newPoints })
      .eq("id", userId);
    if (updateError) throw updateError;

    res.json({ success: true, newPoints, promoCode: usedDiscount ? expectedPromoCode : null });
  } catch (err) {
    console.error("❌ Error finalizing points:", err);
    res.status(500).json({ message: "Failed to finalize points" });
  }
});

// NEW: create shipment & return selectable rates
router.post("/shipping/create-shipment", async (req, res) => {
  const { shippingInfo, items } = req.body || {};
  if (!shippingInfo || !items) return res.status(400).json({ message: "shippingInfo and items required" });
  try {
    const { shipment, rates } = await (async () => {
      const { shipment, rates } = await getCheapestShippoRate({ shippingInfo, items });
      // getCheapestShippoRate already returns all rates; we re-fetch full shipment for clarity
      return { shipment, rates };
    })();
    return res.json({
      success: true,
      shipment_id: shipment?.objectId,
      rates,
    });
  } catch (e) {
    console.error("❌ /shipping/create-shipment error:", e?.message || e);
    return res.status(502).json({ message: "Failed to create shipment", error: e?.message || String(e) });
  }
});

export default router;