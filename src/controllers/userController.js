import supabase from "../../supabaseClient.js";

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