// src/routes/adminRoutes.js
import express from "express";
import { 
  getAllUsers, 
  updateUserRole, 
  deleteUser, 
  getAdminDashboardStats, 
  getAllProducts, 
  resetUserPassword 
} from "../controllers/adminController.js";
import { getAllCategories } from "../controllers/categoryController.js";
import isAdminMiddleware from "../middleware/isAdminMiddleware.js";
import authMiddleware from "../middleware/authMiddleware.js";
import { addProduct, updateProduct, deleteProduct, getProductById } from "../controllers/productController.js";
import multer from "multer";

const router = express.Router();

// ✅ Multer Storage Setup (MemoryStorage for file uploads)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ✅ Middleware to parse FormData fields correctly
const extractFormData = (req, res, next) => {
  const parsedBody = {};
  Object.keys(req.body).forEach((key) => {
    try {
      parsedBody[key] = JSON.parse(req.body[key]);
    } catch {
      parsedBody[key] = req.body[key];
    }
  });
  req.body = parsedBody;
  next();
};

router.patch("/users/:userId/reset-password", authMiddleware, isAdminMiddleware, resetUserPassword);
router.put("/users/:userId/reset-password",   authMiddleware, isAdminMiddleware, resetUserPassword);

// Add this debug route WITHOUT middleware to test the path works
router.all("/users/:userId/reset-password-debug", (req, res) => {
  console.log('[DEBUG ROUTE HIT]', req.method, req.params.userId);
  res.json({ 
    success: true, 
    message: 'Debug route works!',
    method: req.method,
    userId: req.params.userId 
  });
});


// 🔹 Get all users
router.get("/users", isAdminMiddleware, getAllUsers);

// 🔹 Update user role
router.put("/users/:userId", isAdminMiddleware, updateUserRole);

// 🔹 Reset user password (Admin only) - Support both PUT and PATCH
// router.put("/users/:userId/reset-password", isAdminMiddleware, resetUserPassword);
// router.patch("/users/:userId/reset-password", isAdminMiddleware, resetUserPassword); // THIS IS THE NEW LINE

// 🔹 Delete a user
router.delete("/users/:userId", isAdminMiddleware, deleteUser);

// ✅ Route to get admin dashboard statistics
router.get("/dashboard-stats", isAdminMiddleware, getAdminDashboardStats);

router.get("/products", isAdminMiddleware, getAllProducts);

router.get("/categories", isAdminMiddleware, getAllCategories);
router.get("/category", isAdminMiddleware, getAllCategories); // legacy alias

// 🔹 Admin Routes - Manage Products
router.post("/products", isAdminMiddleware, upload.single("image"), extractFormData, addProduct);
router.put("/products/:id", isAdminMiddleware, upload.single("image"), extractFormData, updateProduct);
router.delete("/products/:id", isAdminMiddleware, deleteProduct);
router.get("/products/:id", isAdminMiddleware, getProductById);

export default router;