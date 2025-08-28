import express from "express";
import multer from "multer";
import {
  addProduct,
  getAllProducts,
  updateProduct,
  getProductsByCategory,
  deleteProduct,
  getProductById,
  getBestSellers,
} from "../controllers/productController.js";
import isAdminMiddleware from "../middleware/isAdminMiddleware.js";

const router = express.Router();

// ✅ Multer Storage Setup (Changed to MemoryStorage for DigitalOcean)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ✅ Middleware to parse FormData fields correctly
const extractFormData = (req, res, next) => {
  const parsedBody = {};
  Object.keys(req.body).forEach((key) => {
    try {
      parsedBody[key] = JSON.parse(req.body[key]); // ✅ Parse JSON fields
    } catch {
      parsedBody[key] = req.body[key]; // ✅ Keep string fields as is
    }
  });
  req.body = parsedBody;
  next();
};

// 🔹 Product Routes
// Order matters: place more specific routes before generic ":id" to avoid shadowing
router.get("/", getAllProducts);
router.post("/", isAdminMiddleware, upload.single("image"), extractFormData, addProduct);
router.get("/best-sellers", getBestSellers);
router.get("/category/:categoryId", getProductsByCategory); // must come before ":id"
router.get("/admin/products", isAdminMiddleware, getAllProducts); // must come before ":id"
router.get("/:id", getProductById);
router.put("/:id", isAdminMiddleware, upload.single("image"), extractFormData, updateProduct);
router.delete("/:id", isAdminMiddleware, deleteProduct);

export default router;