import supabase from "../../supabaseClient.js";
import bcrypt from "bcryptjs";


// Fetch user shipping info
export const getShippingInfo = async (req, res) => {
  try {
    const userId = req.params.userId;
    const { data: user, error } = await supabase
      .from("user")
      .select("name, email, address, city, zip, country")
      .eq("id", userId)
      .single();
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update user profile (name, address, city, zip, country)
export const updateUserInfo = async (req, res) => {
  const { id, name, email, address, city, zip, country } = req.body;
  try {
    if (!id) {
      return res.status(400).json({ message: "User ID is required" });
    }
    const { data: updatedUser, error } = await supabase
      .from("user")
      .update({
        name: name || undefined,
        email: email || undefined,
        address: address || undefined,
        city: city || undefined,
        zip: zip || undefined,
        country: country || undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    res.status(200).json({ message: "Profile updated", user: updatedUser });
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

export const getUserInfo = async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId) {
      return res.status(400).json({ message: "User ID is required." });
    }
    // Security: Only allow users to access their own data
    if (req.user.id !== userId) {
      return res.status(403).json({ message: "Forbidden: You can only access your own user data." });
    }
    const { data: user, error } = await supabase
      .from("user")
      .select("id, name, email, address, city, zip, country, points, is_admin")
      .eq("id", userId)
      .single();
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// PUT /users/change-password
export const changePassword = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { currentPassword, newPassword } = req.body || {};

    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "currentPassword and newPassword are required" });
    }
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return res.status(400).json({ message: "newPassword must be at least 8 characters" });
    }

    // Fetch user
    const { data: user, error: getErr } = await supabase
      .from("user")
      .select("id, password, email")
      .eq("id", userId)
      .single();
    if (getErr || !user) return res.status(404).json({ message: "User not found" });

    // Verify current password
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(400).json({ message: "Current password is incorrect" });

    // Hash and update
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(newPassword, salt);

    const { error: updErr } = await supabase
      .from("user")
      .update({ password: hashed, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (updErr) return res.status(500).json({ message: "Failed to update password" });

    return res.json({ success: true });
  } catch (e) {
    console.error("changePassword error:", e);
    return res.status(500).json({ message: "Server error", error: e.message });
  }
};