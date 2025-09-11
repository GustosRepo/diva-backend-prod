import express from "express";
import { registerUser, loginUser, promoteToAdmin } from "../controllers/authController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import isAdminMiddleware from "../middleware/isAdminMiddleware.js";
import supabase from "../../supabaseClient.js";

const router = express.Router();

// 🔹 Register a new user
router.post("/register", registerUser);

// 🔹 Login a user
router.post("/login", loginUser);



// 🔹 Get current user info (Protected)
// 🔹 Get current user info (Protected)
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const { data: user, error } = await supabase
      .from("user")
      .select("id, name, email, role, points, address, city, zip, country")
      .eq("id", userId)
      .single();
      
    if (error || !user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    res.json({
      ok: true,
      user: {
        ...user,
        isAdmin: user.role === "admin"
      }
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// 🔹 Logout (clear HttpOnly cookie)
router.post("/logout", (req, res) => {
  res.clearCookie("token", { path: "/" });
  res.json({ ok: true });
});

// 🔹 Promote a user to admin (Admins only)
router.put("/promote/:userId", isAdminMiddleware, promoteToAdmin);

export default router;