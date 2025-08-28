import express from "express";
import { addCategory, updateCategory, deleteCategory, getAllCategories } from "../controllers/categoryController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import isAdminMiddleware from "../middleware/isAdminMiddleware.js";

const router = express.Router();

// 🔹 Public Route - Get All Categories
router.get("/", getAllCategories);
router.post("/", authMiddleware, isAdminMiddleware, addCategory); // Admin Only
router.put("/:id", authMiddleware, isAdminMiddleware, updateCategory); // Admin Only
router.delete("/:id", authMiddleware, isAdminMiddleware, deleteCategory); // Admin Only

export default router;