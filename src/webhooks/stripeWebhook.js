import Stripe from "stripe";
import dotenv from "dotenv";
import supabase from "../../supabaseClient.js";
import { decrementProductQuantity } from "../controllers/productController.js";
import { shippoClient } from "../shippoClient.js"; // NEW
import sendEmail from "../services/emailServices.js";

dotenv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2022-11-15" });

// ✅ Stripe Webhook Handler
export const stripeWebhookHandler = async (req, res) => {
  if (process.env.NODE_ENV !== 'production') console.log("🚀 Incoming Stripe Webhook");

  // --- Signature verify (expects express.raw on this route) ---
  const sig =
    req.headers["stripe-signature"] ||
    req.headers["Stripe-Signature"] ||
    req.headers["stripe_signature"] ||
    req.headers["Stripe_Signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    if (sig && endpointSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
      if (process.env.NODE_ENV !== 'production') console.log("✅ Stripe signature verified:", event.type);
    } else {
      // Dev-only fallback
      const raw = Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : JSON.stringify(req.body || {});
      event = JSON.parse(raw);
      if (process.env.NODE_ENV !== 'production') console.warn("⚠️ Using unverified event payload (dev fallback). Event type:", event?.type);
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') console.error("❌ Webhook signature verification failed:", error?.message || error);
    return res.status(400).send(`Webhook Error: ${error?.message || error}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object || event.object || {};
  if (process.env.NODE_ENV !== 'production') {
    console.log("📝 Raw session.id:", session.id, "has metadata?", !!session.metadata);
    console.log("📝 session.metadata:", session.metadata);
  }
  // Preview raw body length for signature context
  if (process.env.NODE_ENV !== 'production') console.log("📝 Raw body length:", Buffer.isBuffer(req.body) ? req.body.length : (typeof req.body === 'string' ? req.body.length : 'n/a'));
      const inserted = await processCheckoutSession(session); // ← no res passed

      if (process.env.NODE_ENV !== 'production') console.log("📦 Webhook metadata received:", session?.metadata || null);
      return res.status(200).json({ received: true, order_id: inserted?.id || null });
    }

    if (process.env.NODE_ENV !== 'production') console.log(`ℹ️ Ignoring event type: ${event.type}`);
    return res.status(200).json({ received: true });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') console.error("❌ Error handling Stripe event:", error?.message || error);
    return res.status(500).send("Internal Server Error");
  }
};

// ---------- Helpers ----------

const parseItemsFromSession = async (session) => {
  // 1) Prefer metadata.items (your checkout code sends it)
  try {
    const rawItems = session?.metadata?.items;
  if (process.env.NODE_ENV !== 'production') console.log("🔍 parseItemsFromSession: raw metadata.items =", rawItems);
    if (rawItems) {
      const parsed = typeof rawItems === "string" ? JSON.parse(rawItems) : rawItems;
      if (Array.isArray(parsed)) {
    if (process.env.NODE_ENV !== 'production') console.log("🔍 Parsed metadata.items array length:", parsed.length);
        // Support compact form {id,q,p}
        return parsed.map(it => ({
          id: it.id,
          quantity: Number(it.q || it.quantity || 1),
          price: typeof it.p === 'number' ? it.p / 100 : Number(it.price || 0),
        }));
      }
    }
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn("⚠️ Could not parse metadata.items:", e);
  }

  // 2) Fallback to Stripe line items (will only map if you stored an internal id in price.product.metadata.internal_id)
  try {
    if (session?.id) {
      const li = await stripe.checkout.sessions.listLineItems(session.id, {
        limit: 100,
        expand: ["data.price.product"],
      });
  if (process.env.NODE_ENV !== 'production') console.log("🔍 Stripe line items fetched count:", li.data?.length || 0);
      return li.data
        .map((row) => {
          const internalId = row?.price?.product?.metadata?.internal_id;
          return internalId
            ? {
                id: internalId,
                quantity: Number(row.quantity || 1),
                price:
                  (typeof row.amount_total === "number"
                    ? row.amount_total
                    : row.price?.unit_amount ?? 0) / 100,
              }
            : null;
        })
        .filter(Boolean);
    }
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn("⚠️ Could not fetch Stripe line items:", e);
  }

  return [];
};

const extractEmail = (session) =>
  session?.customer_details?.email ||
  session?.metadata?.email ||
  session?.customer_email ||
  "";

// Build a flat shipping_info (your DB uses snake_case keys inside JSONB)
const extractShippingInfo = (session) => {
  // Preferred: shipping_details (included on session event payload)
  const sd = session?.shipping_details;
  if (sd?.address) {
    return {
      name: sd?.name || null,
      phone: sd?.phone || null,
      address_line1: sd.address?.line1 || null,
      address_line2: sd.address?.line2 || null,
      city: sd.address?.city || null,
      state: sd.address?.state || null,
      country: sd.address?.country || null,
      postal_code: sd.address?.postal_code || null,
    };
  }

  // Fallback: customer_details.address
  const cd = session?.customer_details;
  if (cd?.address) {
    return {
      name: cd?.name || null,
      phone: cd?.phone || null,
      address_line1: cd.address?.line1 || null,
      address_line2: cd.address?.line2 || null,
      city: cd.address?.city || null,
      state: cd.address?.state || null,
      country: cd.address?.country || null,
      postal_code: cd.address?.postal_code || null,
    };
  }

  // Last resort: metadata.shippingInfo (stringified by your checkout)
  try {
    if (session?.metadata?.shippingInfo) {
      const si =
        typeof session.metadata.shippingInfo === "string"
          ? JSON.parse(session.metadata.shippingInfo)
          : session.metadata.shippingInfo;
      return {
        name: si?.name ?? null,
        phone: si?.phone ?? null,
        address_line1: si?.address_line1 ?? null,
        address_line2: si?.address_line2 ?? null,
        city: si?.city ?? null,
        state: si?.state ?? null,
        country: si?.country ?? null,
        postal_code: si?.postal_code ?? null,
      };
    }
  } catch (e) {
    console.warn("⚠️ Failed to parse metadata.shippingInfo:", e);
  }

  return null;
};

const generateTrackingCode = () =>
  `TRK-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ---------- Core ----------

/**
 * Processes a completed checkout.session and inserts into public.order.
 * NOTE: Only inserts columns that actually exist in your table.
 */
const processCheckoutSession = async (session) => {
  if (process.env.NODE_ENV !== 'production') console.log("📦 Processing session:", session?.id);

  // 🔁 Idempotency: if an order already exists for this Stripe session, return it
  if (session?.id) {
    try {
      const { data: existingRows, error: existingErr } = await supabase
        .from("order")
        .select("id,stripe_session_id")
        .eq("stripe_session_id", session.id)
        .limit(1);
      if (!existingErr && Array.isArray(existingRows) && existingRows.length) {
        if (process.env.NODE_ENV !== 'production') console.log("🛑 Duplicate webhook: order already exists for session", session.id, "order id", existingRows[0].id);
        return existingRows[0];
      }
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') console.warn("⚠️ Idempotency check failed (continuing):", e?.message || e);
    }
  }

  // Email required for your order row
  const email = extractEmail(session);
  if (!email) throw new Error("Missing email in checkout session");

  // Build shipping_info jsonb
  const shipping_info = extractShippingInfo(session);
  if (!shipping_info) throw new Error("Missing shipping info in checkout session");

  // Amounts (convert cents → dollars). Your table only has total_amount, so we won't insert subtotal/tax/shipping.
  // Helper to parse amounts coming from Stripe (cents) or from metadata (either cents string like "4999" or dollars like "49.99").
  const parseMetadataAmount = (val) => {
    if (val == null) return 0;
    if (typeof val === "number") {
      // Heuristic: treat large numbers as cents
      return val > 1000 ? val / 100 : val;
    }
    if (typeof val === "string") {
      if (/^\d+$/.test(val)) return parseInt(val, 10) / 100; // all digits -> cents
      const f = parseFloat(val);
      return Number.isFinite(f) ? f : 0; // assume dollars
    }
    return 0;
  };

  // Prefer Stripe-provided fields when available (amounts are in cents).
  const subtotal =
    typeof session?.amount_subtotal === "number"
      ? session.amount_subtotal / 100
      : parseMetadataAmount(session?.metadata?.subtotal);

  const tax_amount =
    (session?.total_details && typeof session.total_details.amount_tax === "number")
      ? session.total_details.amount_tax / 100
      : parseMetadataAmount(session?.metadata?.tax_amount);

  const discount_amount = (session?.total_details?.amount_discount || 0) / 100; // NEW

  const shipping_fee_meta_raw = session?.metadata?.shipping_fee || session?.metadata?.shipping_fee_cents;
  let shipping_fee =
    (session?.total_details && typeof session.total_details.amount_shipping === "number" && session.total_details.amount_shipping > 0)
      ? session.total_details.amount_shipping / 100
      : parseMetadataAmount(shipping_fee_meta_raw);

  const shipping_fee_gross = shipping_fee; // before discount (Stripe doesn't discount shipping when discountable=false)
  const shipping_fee_net = shipping_fee; // placeholder (same now)

  // If still zero but metadata exists and parses to >0, recompute explicitly
  if ((shipping_fee === 0 || !Number.isFinite(shipping_fee)) && shipping_fee_meta_raw) {
    const forced = parseMetadataAmount(shipping_fee_meta_raw);
    if (forced > 0) shipping_fee = forced;
  }

  // Move total_amount calculation BEFORE logging so it is defined
  const total_amount =
    typeof session?.amount_total === "number"
      ? session.amount_total / 100
      : Number((subtotal + tax_amount + shipping_fee).toFixed(2));

  if (process.env.NODE_ENV !== 'production') console.log("💵 amount breakdown:", {
    amount_subtotal: session?.amount_subtotal,
    amount_total: session?.amount_total,
    amount_discount: session?.total_details?.amount_discount,
    stripe_amount_shipping: session?.total_details?.amount_shipping,
    metadata_shipping_fee: shipping_fee_meta_raw,
    computed: { subtotal, tax_amount, discount_amount, shipping_fee: shipping_fee_net, total_amount }
  });

  const user_id = session?.metadata?.userId || null;
  const points_used = Number.parseInt(String(session?.metadata?.pointsUsed ?? "0"), 10) || 0;

  // Flatten address fields (your table has address, city, country, zip)
  const flatAddress = {
    address: shipping_info.address_line1 || null,
    city: shipping_info.city || null,
    country: shipping_info.country || null,
    zip: shipping_info.postal_code || null,
  };

  const shippo_shipment_id = session?.metadata?.shippo_shipment_id || null;
  const shippo_rate_id = session?.metadata?.shippo_rate_id || null;

  // NEW: capture Stripe identifiers
  const stripe_session_id = session?.id || null;
  const stripe_payment_intent_id = typeof session?.payment_intent === 'string'
    ? session.payment_intent
    : (session?.payment_intent?.id || null);

  let tracking_code = generateTrackingCode();
  let tracking_url = null;
  let label_url = null;
  let carrier = null;
  let service = null;
  let shippo_transaction_id = null;

  // Attempt label purchase if shipment + rate present
  if (shippo_shipment_id && shippo_rate_id && shippoClient) {
    try {
      const transaction = await shippoClient.transactions.create({
        rate: shippo_rate_id,
        labelFileType: "PDF",
        async: false,
      });
      shippo_transaction_id = transaction?.objectId || null;
      if (transaction?.status === "SUCCESS") {
        tracking_code = transaction.trackingNumber || tracking_code;
        tracking_url = transaction.trackingUrlProvider || null;
        label_url = transaction.labelUrl || transaction.labelFile || null;
        carrier = transaction.provider || null;
        service = transaction.servicelevel?.name || transaction.servicelevel?.token || null;
      } else {
        console.warn("⚠️ Shippo transaction not successful:", transaction?.status, transaction?.messages);
      }
    } catch (e) {
      console.error("❌ Shippo label purchase failed:", e?.message || e);
    }
  }

  const payload = {
    email,
    user_id,
    status: "Pending",
    shipping_info, // jsonb
    subtotal,
    tax_amount,
    discount_amount,
    shipping_fee_gross,
    shipping_fee_net,
    // existing shipping_fee kept for backward compatibility
    shipping_fee,
    total_amount, // dollars
  points_used, // ADD: persist loyalty points consumed
    tracking_code,
    tracking_url,
    label_url,
    carrier,
    service,
    shippo_shipment_id,
    shippo_rate_id,
    shippo_transaction_id,
    stripe_session_id,            // NEW
    stripe_payment_intent_id,     // NEW
    ...flatAddress,
  };

  if (process.env.NODE_ENV !== 'production') console.log(
    `[Supabase] URL: ${process.env.SUPABASE_URL} | inserting order with fields: ${Object.keys(
      payload
    ).join(", ")}`
  );

  const { data: inserted, error: insertErr } = await supabase
    .from("order")
    .insert([payload])
    .select()
    .single();

  if (insertErr) {
    console.error("❌ Supabase insertErr:", insertErr);
    throw new Error("DB insert failed");
  }

  if (process.env.NODE_ENV !== 'production') console.log("✅ Order inserted:", inserted?.id);

  // ----- Optional: create order_items + decrement stock -----
  const items = await parseItemsFromSession(session);
  if (Array.isArray(items) && items.length > 0) {
    if (process.env.NODE_ENV !== 'production') console.log("🛒 Creating order_items, count:", items.length);
    const orderItemsPayload = items.map((it) => ({
      order_id: inserted.id,
      product_id: it.id,
      quantity: Number(it.quantity || 1),
      price: Number(it.price || 0),
    }));

    const { error: orderItemError } = await supabase.from("order_item").insert(orderItemsPayload);
    if (orderItemError) {
      if (process.env.NODE_ENV !== 'production') console.error("❌ order_item insert error:", orderItemError);
      // rollback
      await supabase.from("order").delete().eq("id", inserted.id);
      throw new Error("Failed to create order items");
    }

    // decrement inventory
    for (const it of items) {
      try {
        const qty = Number(it.quantity || 1);
  if (process.env.NODE_ENV !== 'production') console.log("🛠 Attempting decrement for product", it.id, "qty", qty);
        const { error: decErr } = await decrementProductQuantity(it.id, qty);
        if (decErr) {
          console.warn("⚠️ decrementProductQuantity error for", it.id, decErr);
        } else {
          if (process.env.NODE_ENV !== 'production') console.log(`✅ Decremented stock for product ${it.id} by ${qty}`);
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') console.error("❌ Exception decrementing product", it.id, err);
      }
    }
  } else {
    if (process.env.NODE_ENV !== 'production') console.log("ℹ️ No items to create for order_items (metadata.items missing).");
  }

  // After successful order insert
  if (inserted && inserted.email) {
    // Send order confirmation to customer
    try {
      const subject = "Your Diva Order Confirmation";
      const htmlContent = `<p>Thank you for your order 💅!<br>Order ID: <b>${inserted.id}</b><br>Total: $${inserted.total_amount?.toFixed(2) || "N/A"}</p>`;
      await sendEmail(inserted.email, subject, htmlContent);
      if (process.env.NODE_ENV !== 'production') console.log("✅ Order confirmation email sent to", inserted.email);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error("❌ Failed to send order confirmation email:", err);
    }
    // Send notification email to admin
    try {
      const adminEmail = process.env.ADMIN_EMAIL || "support@divafactorynails.com";
      const subject = "New Order Placed (Stripe Checkout)";
      const htmlContent = `<p>A new order has been placed via Stripe Checkout.<br>Order ID: <b>${inserted.id}</b><br>Customer: ${inserted.email}<br>Total: $${inserted.total_amount?.toFixed(2) || "N/A"}</p>`;
      await sendEmail(adminEmail, subject, htmlContent);
      if (process.env.NODE_ENV !== 'production') console.log("✅ Admin notified of new Stripe order at", adminEmail);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error("❌ Failed to send admin new Stripe order notification:", err);
    }
  }

  return inserted;
};
