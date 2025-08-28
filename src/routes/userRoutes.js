import express from "express";
import { getShippingInfo, updateUserInfo, getUserInfo } from "../controllers/userController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// ✅ Route to get saved shipping info for logged-in user
router.get("/:userId/shipping", authMiddleware, getShippingInfo);

router.put("/update", authMiddleware, updateUserInfo); // ✅ Protected route
router.get("/:userId", authMiddleware, getUserInfo); // ✅ Protected route
router.get("/:Id", authMiddleware, getUserInfo); // ✅ Protected route



export default router;