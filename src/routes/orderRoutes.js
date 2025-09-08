import express from "express";
import {
  getUserOrders,
  createOrder,
  createPickupOrder,
  updateOrderStatus,
  getFilteredOrders,
  searchOrdersByEmail,
  trackOrder,
  cancelOrder,
  getOrderById,
  deleteOrder, // ✅ Import delete function
  markOrderPaid,
  markOrderPickedUp,
  cancelExpiredPickupHolds,
} from "../controllers/orderController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import isAdminMiddleware from "../middleware/isAdminMiddleware.js";

const router = express.Router();

// ✅ Guest-friendly Order Tracking Route
router.get("/track", trackOrder);

// ✅ Admin Routes (Protected)
router.get("/admin/orders", authMiddleware, isAdminMiddleware, getFilteredOrders);
router.get("/admin/orders/:id", authMiddleware, isAdminMiddleware, getOrderById); // Get single order
router.delete("/admin/orders/:orderId", authMiddleware, isAdminMiddleware, deleteOrder); // ✅ Delete order
router.get("/admin/search", authMiddleware, isAdminMiddleware, searchOrdersByEmail); // Search orders by email


// ✅ User Routes
router.get("/my-orders", authMiddleware, getUserOrders); // User's Orders
router.post("/", authMiddleware, createOrder); // Create new order
// Local Pickup (Pay on Pickup)
router.post("/pickup", authMiddleware, createPickupOrder);
router.put("/admin/orders/:orderId", authMiddleware, isAdminMiddleware, updateOrderStatus);
router.put("/:orderId/cancel", authMiddleware, cancelOrder); // Cancel order

// Admin/ops helpers for pickup flow
router.patch("/:id/mark-paid", authMiddleware, isAdminMiddleware, markOrderPaid);
router.patch("/:id/mark-picked-up", authMiddleware, isAdminMiddleware, markOrderPickedUp);
router.patch("/:id/cancel", authMiddleware, isAdminMiddleware, cancelOrder);
router.post("/admin/cancel-expired-pickups", authMiddleware, isAdminMiddleware, cancelExpiredPickupHolds);

export default router;
