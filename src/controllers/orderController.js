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