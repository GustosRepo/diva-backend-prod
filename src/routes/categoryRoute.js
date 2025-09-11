import express from "express";
import {
  addCategory,
  updateCategory,
  deleteCategory,
  getAllCategories,
} from "../controllers/categoryController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import isAdminMiddleware from "../middleware/isAdminMiddleware.js";

// Public: only GET is exposed (no auth)
const publicRouter = express.Router();
publicRouter.get("/", getAllCategories);

// Admin: full CRUD behind auth + isAdmin
const adminRouter = express.Router();
adminRouter.get("/", authMiddleware, isAdminMiddleware, getAllCategories);
adminRouter.post("/", authMiddleware, isAdminMiddleware, addCategory);
adminRouter.put("/:id", authMiddleware, isAdminMiddleware, updateCategory);
adminRouter.delete("/:id", authMiddleware, isAdminMiddleware, deleteCategory);

// Named exports
export { publicRouter, adminRouter };

// Default export for backwards compatibility
export default publicRouter;