import sendEmail from "../services/emailServices.js";
import supabase from "../../supabaseClient.js";
import { decrementProductQuantity } from "./productController.js";
import { incrementProductQuantity } from "./productController.js"; // NEW

// Configuration defaults
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@thedivafactory.com";

// Lightweight in-memory guard to prevent duplicate cancel emails during rapid duplicate calls.
// TTL ensures we don't leak memory in long-running processes.
const CANCEL_EMAIL_SENT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const sentCancelEmails = new Set();

// Lightweight in-memory guard to avoid duplicate cancel emails during short windows
const RECENT_CANCEL_EMAILS = new Set();
const CANCEL_EMAIL_TTL_MS = 5 * 60 * 1000; // 5 minutes
function markCancelEmailSent(orderId) {
  if (RECENT_CANCEL_EMAILS.has(orderId)) return false;
  RECENT_CANCEL_EMAILS.add(orderId);
  setTimeout(() => RECENT_CANCEL_EMAILS.delete(orderId), CANCEL_EMAIL_TTL_MS);
  return true;
}

// Helper: send email without awaiting so controllers return quickly
function sendEmailNonBlocking(to, subject, html) {
  sendEmail(to, subject, html)
    .then(() => console.log(`📧 Email queued/sent to ${to} — ${subject}`))
    .catch((err) => console.error(`❌ Email send failed to ${to}:`, err));
}

// Send shipping notification email
export async function sendShippingNotification(orderId) {
  // Fetch order details (email, tracking_code, etc.)
  const { data: order, error } = await supabase
    .from("order")
    .select("email, tracking_code")
    .eq("id", orderId)
    .single();
  if (error || !order) throw new Error("Order not found for shipping notification");

  const subject = "Your Diva Nails Order Has Shipped!";
  const htmlContent = `<p>Thank you for your order 💅 Your tracking number is: <b>${order.tracking_code}</b></p>`;
  await sendEmail(order.email, subject, htmlContent);
}

// 🔹 Get all orders (Admin)
export const getAllOrders = async (req, res) => {
  try {
    let { status, startDate, endDate, sort, page = 1, limit = 10 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);

    if (isNaN(page) || isNaN(limit) || page < 1 || limit < 1) {
      return res
        .status(400)
        .json({ message: "Page and limit must be positive numbers." });
    }

    // Build filters dynamically
    let filters = {};
    if (status) filters.status = status;
    if (startDate || endDate) {
      filters.created_at = {};
      if (startDate) filters.created_at.gte = startDate;
      if (endDate) filters.created_at.lte = endDate;
    }

    // Get total count for pagination
    const { count: totalOrders, error: countError } = await supabase
      .from("order")
      .select("id", { count: "exact", head: true })
      .match(filters);
    if (countError) throw countError;

    // Fetch orders with filters, pagination, and sorting
    const { data: orders, error } = await supabase
      .from("order")
      .select("*, user!fk_user(email), order_item!fk_order(*, product!fk_product(title, price))")
      .match(filters)
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (error) throw error;

    // Map total_amount to totalAmount for each order
    // Map total_amount to totalAmount for each order
    const cleanedOrders = orders.map(order => ({
      ...order,
      totalAmount: order.total_amount,
    }));

    res.json({
      page,
      limit,
      totalOrders,
      totalPages: Math.ceil(totalOrders / limit),
      orders: cleanedOrders,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// 🔹 Get orders for the logged-in user
export const getMyOrders = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { data: orders, error } = await supabase
      .from("order")
      .select("*, order_item!fk_order(*, product!fk_product(title, price))")
      .eq("user_id", userId);

    if (error) throw error;

    if (orders.length === 0) {
      return res
        .status(404)
        .json({ message: "No orders found for this user." });
    }

    // Normalize DB snake_case fields to frontend-friendly camelCase
    const cleaned = orders.map((o) => ({
      ...o,
      totalAmount: o.total_amount,
      trackingCode: o.tracking_code,
      // Keep shipping_info as-is but also provide top-level fields if needed
      shippingInfo: o.shipping_info || null,
    }));

    res.json(cleaned);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching orders", details: error.message });
  }
};

// 🔹 Create Local Pickup Order (Pay on Pickup)
export const createPickupOrder = async (req, res) => {
  try {
    const authUser = req.user || {};
    const userId = authUser.id || authUser.userId;

    const { items, customer, notes } = req.body || {};
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "items required" });
    }

    // Enforce max 2 open reservations per user
    const { data: existingReservations, error: existingErr } = await supabase
      .from("order")
      .select("id, status, shipping_info")
      .eq("user_id", userId)
      .contains("shipping_info", { shipping_method: "local_pickup" });
    if (existingErr) {
      console.warn("⚠️ Failed to check existing reservations:", existingErr?.message || existingErr);
    } else {
      const openCount = (existingReservations || []).filter((o) => {
        const st = (o.status || '').toLowerCase();
        return st === 'awaiting_pickup' || st === 'pending';
      }).length;
      if (openCount >= 2) {
        return res.status(429).json({ message: "Too many active pickup holds. Please complete or cancel an existing hold before creating a new one." });
      }
    }

    // Fetch authoritative product info
    const productIds = items.map((it) => it.id || it.product_id).filter(Boolean);
    if (productIds.length !== items.length) {
      return res.status(400).json({ message: "Each item must include an id" });
    }
    const { data: products, error: prodErr } = await supabase
      .from("product")
      .select("id, title, price, quantity, brand_segment")
      .in("id", productIds);
    if (prodErr) throw prodErr;
    if (!products || products.length !== productIds.length) {
      return res.status(400).json({ message: "One or more products not found" });
    }

    // Map product by id for quick lookup
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Validate quantities and compute subtotal from authoritative prices
    let subtotal = 0;
    for (const it of items) {
      const pid = it.id || it.product_id;
      const qty = Number(it.quantity || 1);
      if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ message: "Invalid quantity" });
      const prod = productMap.get(pid);
      if (!prod) return res.status(400).json({ message: `Product ${pid} not found` });
      const available = Number(prod.quantity || 0);
      if (available < qty) {
        return res.status(409).json({ message: `Insufficient stock for ${prod.title}`, product_id: pid, available });
      }
      subtotal += Number(prod.price) * qty;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 48h

    // Build shipping_info JSON to hold pickup-specific fields without DB migration
    const shippingInfo = {
      shipping_method: "local_pickup",
      payment_method: "pay_on_pickup",
      payment_status: "unpaid",
      taxes: 0,
      notes: notes || null,
      pickup: {
        reservation_expires_at: expiresAt.toISOString(),
        window_hours: "8am–8pm",
        instructions: "Reserved 48h. DM/email to coordinate pickup time/location.",
        contact_email: process.env.ADMIN_EMAIL || "admin@thedivafactory.com",
      },
      customer: customer || null,
    };

    // Insert order
    const orderInsert = {
      user_id: userId,
      email: customer?.email || authUser.email || null,
      total_amount: Math.max(0, Number(subtotal)),
      status: "awaiting_pickup",
      tracking_code: "Pickup",
      shipping_info: shippingInfo,
      points_used: 0,
    };
    const { data: newOrder, error: orderErr } = await supabase
      .from("order")
      .insert([orderInsert])
      .select()
      .single();
    if (orderErr) {
      console.error("❌ Pickup order insert failed:", orderErr);
      return res.status(500).json({ message: "Failed to create pickup order" });
    }

    // Insert order items with unit price snapshot
    const orderItemsPayload = items.map((it) => {
      const pid = it.id || it.product_id;
      const prod = productMap.get(pid);
      const qty = Number(it.quantity || 1);
      return {
        order_id: newOrder.id,
        product_id: pid,
        quantity: qty,
        price: Number(prod.price), // snapshot per unit
        product_brand_segment: (prod.brand_segment || '').toLowerCase() || null,
      };
    });
    const { error: itemsErr } = await supabase.from("order_item").insert(orderItemsPayload);
    if (itemsErr) {
      console.error("❌ Failed to insert order items for pickup:", itemsErr);
      // Best-effort rollback of order
      try { await supabase.from("order").delete().eq("id", newOrder.id); } catch (e) {}
      return res.status(500).json({ message: "Failed to create pickup order items" });
    }

    // Decrement inventory immediately (Option A)
    for (const it of items) {
      const pid = it.id || it.product_id;
      const qty = Number(it.quantity || 1);
      const { error: decErr } = await decrementProductQuantity(pid, qty);
      if (decErr) {
        console.warn("⚠️ Inventory decrement failed for", pid, decErr);
      }
    }

    // Send confirmation email to customer
    try {
      const to = orderInsert.email;
      if (to) {
        const subject = "Your Pickup Order is Reserved (48h)";
        const html = `
          <div style="font-family: Arial, sans-serif; padding:16px">
            <h2 style="color:#d63384">Local Pickup Reserved</h2>
            <p>Order <b>${newOrder.id}</b> is reserved for <b>48 hours</b>.</p>
            <p>Pickup hours: <b>8am–8pm</b>. We will coordinate time/location — reply to this email or contact <a href="mailto:${shippingInfo.pickup.contact_email}">${shippingInfo.pickup.contact_email}</a>.</p>
            <p>Total due at pickup: <b>$${orderInsert.total_amount.toFixed(2)}</b></p>
            <p>Reservation expires: <b>${expiresAt.toISOString()}</b></p>
          </div>`;
        sendEmailNonBlocking(to, subject, html);
      }
      // Notify admin
      const aSub = `New Local Pickup Hold: ${newOrder.id}`;
      const aHtml = `<p>Pickup order <b>${newOrder.id}</b> created. Amount due $${orderInsert.total_amount.toFixed(2)}. Expires ${expiresAt.toISOString()}.</p>`;
      sendEmailNonBlocking(ADMIN_EMAIL, aSub, aHtml);
    } catch (e) {
      console.warn("⚠️ Pickup email send warning:", e?.message || e);
    }

    return res.status(201).json({
      order_id: newOrder.id,
      status: "awaiting_pickup",
      reservation_expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("❌ createPickupOrder error:", err);
    return res.status(500).json({ message: "Failed to create pickup order", error: err?.message || String(err) });
  }
};

// 🔹 Upload payment proof (image/pdf) for an order
export const uploadPaymentProof = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user || {};

    // Validate order exists
    const { data: order, error } = await supabase
      .from("order")
      .select("id, user_id, shipping_info")
      .eq("id", id)
      .single();
    if (error || !order) return res.status(404).json({ message: "Order not found" });

    // Check ownership or admin
    const isOwner = String(order.user_id) === String(user.id || user.userId);
    const isAdmin = (user.role === 'admin' || user.isAdmin === true);
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Not authorized to upload proof for this order" });
    }

    // Validate file from multer
    const file = req.file;
    if (!file) return res.status(400).json({ message: "file is required (image/* or application/pdf)" });

    const bucket = process.env.SUPABASE_ORDERS_BUCKET || process.env.SUPABASE_BUCKET || 'orders';
    const timestamp = Date.now();
    const safeName = String(file.originalname || 'proof').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const path = `orders/${id}/${timestamp}_${safeName}`;

    // Upload to Supabase Storage
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
    if (upErr) {
      console.error("❌ payment proof upload error:", upErr);
      return res.status(500).json({ message: "Failed to upload file" });
    }

    // Public URL (assumes bucket public); fallback to signed URL
    let publicUrl = supabase.storage.from(bucket).getPublicUrl(path)?.data?.publicUrl;
    if (!publicUrl) {
      try {
        const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7); // 7 days
        publicUrl = signed?.signedUrl || null;
      } catch (_) {}
    }

    const info = order.shipping_info || {};
    info.payment_proof_url = publicUrl;
    info.payment_proof_status = "submitted";
    info.payment_proof_uploaded_at = new Date().toISOString();

    const { error: updErr } = await supabase
      .from("order")
      .update({ shipping_info: info })
      .eq("id", id);
    if (updErr) return res.status(500).json({ message: "Failed to update order with proof URL" });

    return res.status(201).json({ payment_proof_url: publicUrl });
  } catch (e) {
    console.error("❌ uploadPaymentProof error:", e);
    return res.status(500).json({ message: "Failed to upload payment proof" });
  }
};

// 🔹 Create a new order with validation
// 🔹 Create a new order with validation
export const createOrder = async (req, res) => {
  const {
    userId,
    email,
    items,
    totalAmount,
    status,
    trackingCode,
    shippingInfo,
    pointsUsed,
    isLocalPickup,
  } = req.body;

  console.log("[createOrder] Incoming order data:", req.body);

  // Required: userId, email, items (non-empty), shippingInfo
  if (!userId || !email || !Array.isArray(items) || items.length === 0 || !shippingInfo) {
    return res.status(400).json({ message: "Missing required order fields" });
  }

  try {
    // Get user + points
    const { data: user, error: userError } = await supabase
      .from("user")
      .select("points")
      .eq("id", userId)
      .single();
    if (userError) throw userError;
    if (!user) return res.status(404).json({ message: "User not found" });

    const userPoints = user.points || 0;

    // Calculate discount from points
    let discount = 0;
    if (pointsUsed === 50) discount = totalAmount * 0.05;
    if (pointsUsed === 100) discount = totalAmount * 0.1;

    // If local pickup, shipping is $0 (ignore any shipping fee in totalAmount)
    let finalTotal;
      let shippingFee = 0;
      if (isLocalPickup || req.body.isLocal) {
        shippingFee = 0;
      } else {
        // You can set shippingFee from shippingInfo or other logic here
        shippingFee = shippingInfo?.fee || 0;
      }
      finalTotal = Math.max(0, Number(totalAmount) - discount + shippingFee);

    // 1) Insert order
    const orderPayload = {
      user_id: userId,
      email,
      total_amount: finalTotal,
      status: status || "Pending",
      tracking_code: trackingCode || "Processing",
      shipping_info: shippingInfo,
      points_used: pointsUsed || 0,
    };

    const { data: newOrder, error: orderError } = await supabase
      .from("order")
      .insert([orderPayload])
      .select()
      .single();

    if (orderError) {
      console.error("❌ Order insert error:", orderError);
      return res.status(500).json({ message: "Order insert failed", details: orderError.message });
    }
    if (!newOrder?.id) {
      return res.status(500).json({ message: "Order insert failed or missing ID" });
    }

    // 2) Insert order items
    // Enrich each item with product_brand_segment from current product record if not provided
    const orderItemsPayload = [];
    for (const item of items) {
      const productId = item.id || item.product_id;
      let brandSegment = (item.brandSegment || item.brand_segment || '').toLowerCase();
      if (!brandSegment && productId) {
        const { data: prodRow } = await supabase.from('product').select('brand_segment').eq('id', productId).single();
        if (prodRow?.brand_segment) brandSegment = prodRow.brand_segment.toLowerCase();
      }
      orderItemsPayload.push({
        order_id: newOrder.id,
        product_id: productId,
        quantity: Number(item.quantity || 1),
        price: Number(item.price || 0),
        product_brand_segment: brandSegment || null,
      });
    }
    const { error: orderItemError } = await supabase.from("order_item").insert(orderItemsPayload);
    if (orderItemError) {
      console.error("❌ order_item insert error:", orderItemError);
      // Attempt rollback of order
      try {
        await supabase.from("order").delete().eq("id", newOrder.id);
      } catch (rbErr) {
        console.error("❌ Rollback failed:", rbErr);
      }
      return res.status(500).json({ message: "Failed to create order items", details: orderItemError.message });
    }

    // 3) Decrement inventory per item (atomic via RPC)
    try {
      for (const item of items) {
        const productId = item?.id ?? item?.product_id;
        const qty = Number(item?.quantity || 1);
        if (!productId) {
          console.warn("⚠️ Missing product id on order item, skipping:", item);
          continue;
        }
        const { error: decErr } = await decrementProductQuantity(productId, qty);
        if (decErr) {
          console.error(`❌ Inventory decrement failed for ${productId} x${qty}:`, decErr);
          // Optional: set order to On Hold if stock insufficient
          // await supabase.from('order').update({ status: 'On Hold' }).eq('id', newOrder.id);
        } else {
          console.log(`✅ Inventory decremented for ${productId} by ${qty}`);
        }
      }
    } catch (invErr) {
      console.error("❌ Unexpected inventory decrement error:", invErr);
      // continue; order stays created
    }

    // 4) Update user points balance
    const newPointsBalance = userPoints - (pointsUsed || 0) + Math.floor(finalTotal);
    await supabase.from("user").update({ points: newPointsBalance }).eq("id", userId);

    // Send order confirmation email to customer
      {
        const subject = "Your Diva Nails Order Confirmation";
        const htmlContent = `
          <div style="font-family: Arial, sans-serif; background: #fff; padding: 24px; border-radius: 8px; box-shadow: 0 2px 8px #eee;">
            <h2 style="color: #d63384;">Thank you for your order 💅!</h2>
            <p>Your order has been received and is being processed.</p>
            <table style="margin: 16px 0; border-collapse: collapse;">
              <tr>
                <td style="font-weight: bold; padding: 4px 8px;">Order ID:</td>
                <td style="padding: 4px 8px;">${newOrder.id}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; padding: 4px 8px;">Total:</td>
                <td style="padding: 4px 8px;">$${finalTotal.toFixed(2)}</td>
              </tr>
            </table>
            <p>We’ll send you another email when your order ships.<br>
            If you have any questions, reply to this email or contact us at <a href="mailto:support@divafactorynails.com">support@divafactorynails.com</a>.</p>
            <hr style="margin: 24px 0;">
            <p style="font-size: 12px; color: #888;">Diva Nails &copy; 2025</p>
          </div>
        `;
        sendEmail(email, subject, htmlContent)
          .then(() => console.log("✅ Order confirmation email sent to", email))
          .catch((err) => console.error("❌ Failed to send order confirmation email:", err));
      }
    // Send notification email to admin
      {
        const subject = "New Order Placed";
        const htmlContent = `<p>A new order has been placed.<br>Order ID: <b>${newOrder.id}</b><br>Customer: ${email}<br>Total: $${finalTotal.toFixed(2)}</p>`;
        sendEmail(ADMIN_EMAIL, subject, htmlContent)
          .then(() => console.log("✅ Admin notified of new order at", ADMIN_EMAIL))
          .catch((err) => console.error("❌ Failed to send admin new order notification:", err));
      }
    // Done
    res.status(201).json({
      message: "Order placed!",
      order: newOrder,
      pointsUsed,
      discountApplied: discount,
    });
  } catch (error) {
    console.error("❌ Error creating order:", error);
    res.status(500).json({ message: "Error creating order", details: error.message });
  }
};

// 🔹 Update order status (Admin Only)
export const updateOrderStatus = async (req, res) => {
  const { orderId } = req.params;
  const { status, trackingCode } = req.body; // ✅ Accept trackingCode

  // ✅ Ensure status is valid
  if (!["Pending", "Shipped", "Delivered", "Canceled"].includes(status)) {
    return res.status(400).json({
      message:
        "Invalid status. Must be Pending, Shipped, Delivered, or Canceled.",
    });
  }

  try {
    // ✅ Check if the order exists
    const { data: order, error: orderError } = await supabase
      .from("order")
      .select()
      .eq("id", orderId)
      .single();

    if (orderError) throw orderError;
    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    let updateData = { status };
    if (status === "Shipped" && trackingCode) {
      updateData.tracking_code = trackingCode;
    }

    // ✅ Update the order
    const { data: updatedOrder, error: updateError } = await supabase
      .from("order")
      .update(updateData)
      .eq("id", orderId)
      .select()
      .single();

    if (updateError) throw updateError;

    // ✅ If shipped, send tracking email
    if (status === "Shipped" && trackingCode) {
      try {
        await sendShippingNotification(orderId);
        console.log(`📦 Shipping notification sent to ${updatedOrder.email}`);
      } catch (err) {
        console.error("❌ Failed to send shipping notification email:", err);
      }
    } else {
      // Send admin notification for other status updates
      const subject = `Order ${orderId} Status Updated`;
      const htmlContent = `<p>Order <b>${orderId}</b> status updated to <b>${status}</b>.<br>Tracking Code: ${trackingCode || "N/A"}</p>`;
      sendEmail(ADMIN_EMAIL, subject, htmlContent)
        .then(() => console.log("✅ Admin notified of order status update at", ADMIN_EMAIL))
        .catch((err) => console.error("❌ Failed to send admin status update notification:", err));
    }
    // Send email notification for canceled orders
    if (status === "Canceled") {
      console.log("[DEBUG] Cancel email logic reached for order:", orderId, updatedOrder.email);
      try {
        const subject = "Your Diva Nails Order Has Been Canceled";
        const htmlContent = `
          <div style="font-family: Arial, sans-serif; background: #fff; padding: 24px; border-radius: 8px; box-shadow: 0 2px 8px #eee;">
            <h2 style="color: #d63384;">Order Canceled</h2>
            <p>Your order <b>${orderId}</b> has been canceled. If you have any questions, please contact us at <a href="mailto:support@divafactorynails.com">support@divafactorynails.com</a>.</p>
            <hr style="margin: 24px 0;">
            <p style="font-size: 12px; color: #888;">Diva Nails &copy; 2025</p>
          </div>
        `;
        await sendEmail(updatedOrder.email, subject, htmlContent);
        console.log("✅ Canceled order email sent to", updatedOrder.email);
      } catch (err) {
        console.error("❌ Failed to send canceled order email:", err);
      }
      // Notify admin about cancellation
      try {
        const adminEmail = process.env.ADMIN_EMAIL || "admin@thedivafactory.com";
        const subject = `Order ${orderId} Canceled`;
        const htmlContent = `<p>Order <b>${orderId}</b> has been canceled by the user <b>${updatedOrder.email}</b>.</p>`;
        await sendEmail(adminEmail, subject, htmlContent);
        console.log("✅ Admin notified of order cancellation at", adminEmail);
      } catch (err) {
        console.error("❌ Failed to send admin cancellation notification:", err);
      }
      // Only send cancellation notifications, skip generic status update
    } else if (status === "Shipped" && trackingCode) {
      try {
        await sendShippingNotification(orderId);
        console.log(`📦 Shipping notification sent to ${updatedOrder.email}`);
      } catch (err) {
        console.error("❌ Failed to send shipping notification email:", err);
      }
    }

    res.json(updatedOrder);
  } catch (error) {
    console.error("❌ Error updating order:", error);
    res.status(500).json({ message: "Error updating order", error: error.message });
  }
};

// 🔹 Admin: mark order paid
export const markOrderPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: order, error } = await supabase
      .from("order")
      .select("id, shipping_info")
      .eq("id", id)
      .single();
    if (error || !order) return res.status(404).json({ message: "Order not found" });
    const info = order.shipping_info || {};
    info.payment_status = "paid";
    const { data: updated, error: updErr } = await supabase
      .from("order")
      .update({ shipping_info: info })
      .eq("id", id)
      .select()
      .single();
    if (updErr) throw updErr;
    return res.json({ success: true, order_id: updated.id, payment_status: updated.shipping_info?.payment_status || "paid" });
  } catch (e) {
    console.error("❌ markOrderPaid error:", e);
    return res.status(500).json({ message: "Failed to mark order paid" });
  }
};

// 🔹 Admin: mark order picked up
export const markOrderPickedUp = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: updated, error } = await supabase
      .from("order")
      .update({ status: "picked_up" })
      .eq("id", id)
      .select()
      .single();
    if (error || !updated) return res.status(404).json({ message: "Order not found" });
    return res.json({ success: true, order_id: updated.id, status: updated.status });
  } catch (e) {
    console.error("❌ markOrderPickedUp error:", e);
    return res.status(500).json({ message: "Failed to mark order picked up" });
  }
};

// 🔹 Admin: cancel expired local pickup holds and restock
export const cancelExpiredPickupHolds = async (_req, res) => {
  try {
    const nowIso = new Date().toISOString();
    // Fetch candidate orders
    const { data: orders, error } = await supabase
      .from("order")
      .select("id, status, shipping_info")
      .contains("shipping_info", { shipping_method: "local_pickup" })
      .in("status", ["awaiting_pickup"]) // only holds
      .order("created_at", { ascending: true });
    if (error) throw error;

    let processed = 0, restocked = 0;
    for (const o of orders || []) {
      const exp = o?.shipping_info?.pickup?.reservation_expires_at;
      if (!exp || exp > nowIso) continue; // not expired yet
      // Skip if already marked paid
      const payStatus = (o?.shipping_info?.payment_status || '').toLowerCase();
      if (payStatus === 'paid') continue;

      // Restock items
      const { data: items } = await supabase
        .from("order_item")
        .select("product_id, quantity")
        .eq("order_id", o.id);
      if (Array.isArray(items)) {
        for (const it of items) {
          const { error: incErr } = await incrementProductQuantity(it.product_id, it.quantity);
          if (!incErr) restocked++;
        }
      }

      // Cancel order and flag in shipping_info
      const info = { ...(o.shipping_info || {}) };
      info.pickup = { ...(info.pickup || {}), expired_at: nowIso };
      await supabase
        .from("order")
        .update({ status: "canceled", shipping_info: info })
        .eq("id", o.id);
      processed++;
    }
    return res.json({ success: true, processed, restocked });
  } catch (e) {
    console.error("❌ cancelExpiredPickupHolds error:", e);
    return res.status(500).json({ message: "Failed to cancel expired pickup holds" });
  }
};
// 🔹 Delete order (Admin Only)
export const deleteOrder = async (req, res) => {
  const { orderId } = req.params;
  try {
    const { data: order, error: orderError } = await supabase
      .from("order")
      .select()
      .eq("id", orderId)
      .single();

    if (orderError) throw orderError;
    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    // 🧹 Delete related order_items first
    await supabase.from("order_item").delete().eq("orderId", orderId);

    // 🗑 Now delete the order
    await supabase.from("order").delete().eq("id", orderId);

    res.json({ message: "Order deleted successfully." });
  } catch (error) {
    console.error("❌ Error deleting order:", error);
    res
      .status(500)
      .json({ message: "Error deleting order", details: error.message });
  }
};

// 🔹 Get user-specific orders (Admin Only)
export const getUserOrders = async (req, res) => {
  try {
    console.log("🔍 Incoming request headers:", req.headers); // ✅ Debug incoming headers
    console.log("🔍 Decoded user from auth middleware:", req.user); // ✅ Debug authentication

    const userId = req.user?.id || req.user?.userId; // support both cases
    if (!userId) {
      console.error("❌ Missing user ID in request!");
      return res
        .status(400)
        .json({ message: "User ID is missing from request." });
    }

    console.log("🔍 Fetching orders for user:", userId);

    const { data: orders, error } = await supabase
      .from("order")
      .select("*, order_item!fk_order(*, product!fk_product(title, price))")
      .eq("user_id", userId);

    if (error) throw error;

    if (!orders.length) {
      console.log("❌ No orders found for user:", userId);
      return res.status(404).json({ message: "No orders found." });
    }

    console.log("✅ Orders found:", orders);
    // Normalize DB snake_case -> frontend camelCase for consistency
    const cleaned = orders.map((o) => ({
      ...o,
      totalAmount: o.total_amount,
      trackingCode: o.tracking_code,
      shippingInfo: o.shipping_info || null,
    }));

    res.json(cleaned);
  } catch (error) {
    console.error("❌ Error fetching orders:", error);
    res
      .status(500)
      .json({ message: "Error fetching user orders", details: error.message });
  }
};

export const getFilteredOrders = async (req, res) => {
  try {
    let { status, page = 1, limit = 10 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);

    if (isNaN(page) || isNaN(limit) || page < 1 || limit < 1) {
      return res
        .status(400)
        .json({ message: "Page and limit must be positive numbers." });
    }

    const filters = {};
    if (status) filters.status = status;

    const { count: totalOrders, error: countError } = await supabase
      .from("order")
      .select("id", { count: "exact", head: true })
      .match(filters);

    if (countError) throw countError;

    // ✅ Ensure user.email is fetched properly
    const { data: orders, error } = await supabase
      .from("order")
      .select("*, user!fk_user(email), order_item!fk_order(*, product!fk_product(title, price))")
      .match(filters)
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw error;

    res.json({
      page,
      limit,
      totalOrders,
      totalPages: Math.ceil(totalOrders / limit),
      orders: orders.map((order) => ({
        ...order,
        customerEmail: order.user?.email || order.email,
        // normalize DB snake_case to frontend camelCase
        totalAmount: order.total_amount,
        trackingCode: order.tracking_code,
      })),
    });
  } catch (error) {
    console.error("❌ Error fetching orders:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const searchOrdersByEmail = async (req, res) => {
  try {
    const { email, page = 1, limit = 10 } = req.query;
    if (!email) {
      return res.status(400).json({ message: "Email query is required" });
    }

    const { count: totalOrders, error: countError } = await supabase
      .from("order")
      .select("id", { count: "exact", head: true })
      .match({
        user: { email: { contains: email, op: "ilike" } },
      });

    if (countError) throw countError;

    const { data: orders, error } = await supabase
      .from("order")
      .select("User(id, email), Product(id, title, price)")
      .match({
        user: { email: { contains: email, op: "ilike" } },
      })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw error;

    res.json({
      page,
      limit,
      totalOrders,
      totalPages: Math.ceil(totalOrders / limit),
      orders,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error searching orders", error: error.message });
  }
};

// ✅ Function to Track Orders
export const trackOrder = async (req, res) => {
  const { orderId, email } = req.query;

  if (!orderId || !email) {
    return res.status(400).json({ error: "Order ID and email are required" });
  }

  try {
    const { data: order, error } = await supabase
      .from("order")
      .select("*, order_item(*)")
      .eq("id", orderId)
      .single();

    if (error) throw error;
    if (!order || order.email !== email) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json(order);
  } catch (error) {
    console.error("❌ Error tracking order:", error);
    res.status(500).json({ message: "Error tracking order", error: error.message });
  }
};

// 🔹 Cancel order (User & Admin)
export const cancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user?.id;

    const { data: order, error: orderError } = await supabase
      .from("order")
      .select()
      .eq("id", orderId)
      .single();

    if (orderError) throw orderError;
    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    if (order.user_id !== userId && req.user.role !== "admin") {
      return res
        .status(403)
        .json({ message: "Unauthorized to cancel this order." });
    }

    if (order.status !== "Pending") {
      return res
        .status(400)
        .json({ message: "Order cannot be canceled after it has been processed." });
    }

    // Fetch order items for restocking
    let restockSucceeded = 0;
    let restockFailed = 0;
    try {
      const { data: items, error: itemsErr } = await supabase
        .from("order_item")
        .select("product_id, quantity")
        .eq("order_id", orderId);
      if (itemsErr) {
        console.warn("⚠️ Could not fetch order items for restock:", itemsErr);
      } else if (Array.isArray(items)) {
        for (const it of items) {
          const { error: incErr } = await incrementProductQuantity(it.product_id, it.quantity);
            if (incErr) {
              restockFailed++;
              console.warn("⚠️ Restock failed for product", it.product_id, incErr);
            } else {
              restockSucceeded++;
              console.log(`🔄 Restocked product ${it.product_id} by ${it.quantity}`);
            }
        }
      }
    } catch (e) {
      console.error("❌ Unexpected error during restock loop:", e);
    }

    await supabase
      .from("order")
      .update({ status: "Canceled" })
      .eq("id", orderId);

    console.log(`✅ Order ${orderId} canceled. Restock summary: success=${restockSucceeded} failed=${restockFailed}`);
      // Lightweight in-memory guard to prevent duplicate cancel emails
      if (!sentCancelEmails.has(orderId)) {
        sentCancelEmails.add(orderId);
        setTimeout(() => sentCancelEmails.delete(orderId), CANCEL_EMAIL_SENT_TTL_MS);
        const subject = "Your Diva Nails Order Has Been Canceled";
        const htmlContent = `
          <h2 style=\"color: #d63384;\">Order Canceled</h2>
          <p>Your order <b>${orderId}</b> has been canceled. If you have any questions, please contact us at <a href=\"mailto:support@divafactorynails.com\">support@divafactorynails.com</a>.</p>
        `;
        sendEmail(order.email, subject, htmlContent)
          .then(() => console.log("✅ Canceled order email sent to", order.email))
          .catch((err) => console.error("❌ Failed to send canceled order email:", err));
        // Notify admin about cancellation
        const adminSubject = `Order ${orderId} Canceled`;
        const adminHtml = `<p>Order <b>${orderId}</b> has been canceled by the user <b>${order.email}</b>.</p>`;
        sendEmail(ADMIN_EMAIL, adminSubject, adminHtml)
          .then(() => console.log("✅ Admin notified of order cancellation at", ADMIN_EMAIL))
          .catch((err) => console.error("❌ Failed to send admin cancellation notification:", err));
      } else {
        console.log(`[DEBUG] Cancel email for order ${orderId} already sent recently, skipping duplicate.`);
      }
    res.json({ message: "Order successfully canceled.", restock: { success: restockSucceeded, failed: restockFailed } });
  } catch (error) {
    console.error("❌ Error canceling order:", error);
    res.status(500).json({ message: "Error canceling order", details: error.message });
  }
};

// 🔹 Get order by ID (Public)
export const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "Order ID required" });

    const { data: order, error } = await supabase
      .from("order")
      .select("*, order_item!fk_order(*, product!fk_product(title, price))")
      .eq("id", id)
      .single();

    if (error) {
      return res.status(404).json({ message: "Order not found", details: error.message });
    }

    const cleaned = {
      ...order,
      totalAmount: order.total_amount,
      trackingCode: order.tracking_code,
      shippingInfo: order.shipping_info || null,
    };

    res.json(cleaned);
  } catch (err) {
    console.error("❌ Error fetching order by ID:", err);
    res.status(500).json({ message: "Error fetching order by ID", details: err.message });
  }
};
