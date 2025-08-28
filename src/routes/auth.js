import express from "express";
import { registerUser, loginUser, promoteToAdmin } from "../controllers/authController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import isAdminMiddleware from "../middleware/isAdminMiddleware.js";

const router = express.Router();

// 🔹 Register a new user
router.post("/register", registerUser);

// 🔹 Login a user
router.post("/login", loginUser);

// 🔹 Get current user info (Protected)
router.get("/me", authMiddleware, (req, res) => {
  res.json(req.user);
});

// 🔹 Promote a user to admin (Admins only)
router.put("/promote/:userId", isAdminMiddleware, promoteToAdmin);

export default router;