import express from "express";
import {
  getAllPopupEvents,
  createPopupEvent,
  updatePopupEvent,
  deletePopupEvent,
  getPopupEventById
} from "../controllers/popupEventController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import isAdminMiddleware from "../middleware/isAdminMiddleware.js";

const router = express.Router();

// ✅ Public Routes
router.get("/", getAllPopupEvents); // GET /api/popup-events
router.get("/:id", getPopupEventById); // GET /api/popup-events/:id

// ✅ Admin Routes (Protected)
router.post("/", authMiddleware, isAdminMiddleware, createPopupEvent); // POST /api/popup-events
router.put("/:id", authMiddleware, isAdminMiddleware, updatePopupEvent); // PUT /api/popup-events/:id
router.delete("/:id", authMiddleware, isAdminMiddleware, deletePopupEvent); // DELETE /api/popup-events/:id

export default router;
