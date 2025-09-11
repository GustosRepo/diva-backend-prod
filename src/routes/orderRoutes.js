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
  deleteOrder,
  markOrderPaid,
  markOrderPickedUp,
  cancelExpiredPickupHolds,
  uploadPaymentProof,
} from "../controllers/orderController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import isAdminMiddleware from "../middleware/isAdminMiddleware.js";
import multer from "multer";

// Multer for payment proof uploads (10MB limit, images/pdf only)
const proofStorage = multer.memoryStorage();
const proofUpload = multer({
  storage: proofStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype?.startsWith('image/') || file.mimetype === 'application/pdf';
    if (!ok) return cb(new Error('Only images or PDF allowed'));
    cb(null, true);
  }
});

// =====================
// Public/User router (mount at /orders)
// =====================
export const publicRouter = express.Router();

// Guest-friendly order tracking
publicRouter.get("/track", trackOrder);

// User routes
publicRouter.get("/my-orders", authMiddleware, getUserOrders); // User's Orders
publicRouter.post("/", authMiddleware, createOrder); // Create new order
publicRouter.post("/pickup", authMiddleware, createPickupOrder); // Local Pickup (Pay on Pickup)
publicRouter.put("/:orderId/cancel", authMiddleware, cancelOrder); // User/Admin cancel by id

// Upload payment proof
publicRouter.post("/:id/payment-proof", authMiddleware, proofUpload.single('file'), uploadPaymentProof);

// =====================
// Admin router (mount at /admin/orders)
// =====================
export const adminRouter = express.Router();

// Admin list/search
adminRouter.get("/", authMiddleware, isAdminMiddleware, getFilteredOrders); // GET /admin/orders
adminRouter.get("/search", authMiddleware, isAdminMiddleware, searchOrdersByEmail); // GET /admin/orders/search

// Admin CRUD on a single order
adminRouter.get("/:id", authMiddleware, isAdminMiddleware, getOrderById); // GET /admin/orders/:id
adminRouter.put("/:orderId", authMiddleware, isAdminMiddleware, updateOrderStatus); // PUT /admin/orders/:orderId
adminRouter.delete("/:orderId", authMiddleware, isAdminMiddleware, deleteOrder); // DELETE /admin/orders/:orderId

// Admin helpers for pickup/payment flow
adminRouter.patch("/:id/mark-paid", authMiddleware, isAdminMiddleware, markOrderPaid);
adminRouter.patch("/:id/mark-picked-up", authMiddleware, isAdminMiddleware, markOrderPickedUp);
adminRouter.patch("/:id/cancel", authMiddleware, isAdminMiddleware, cancelOrder);
adminRouter.post("/cancel-expired-pickups", authMiddleware, isAdminMiddleware, cancelExpiredPickupHolds);

export default { publicRouter, adminRouter };
