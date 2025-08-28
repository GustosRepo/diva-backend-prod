import express from "express";
import {
  getUserOrders,
  createOrder,
  updateOrderStatus,
  getFilteredOrders,
  searchOrdersByEmail,
  trackOrder,
  cancelOrder,
  getOrderById,
  deleteOrder, // ✅ Import delete function
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
router.put("/admin/orders/:orderId", authMiddleware, isAdminMiddleware, updateOrderStatus);
router.put("/:orderId/cancel", authMiddleware, cancelOrder); // Cancel order

export default router;