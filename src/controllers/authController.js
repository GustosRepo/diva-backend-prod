import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import supabase from "../../supabaseClient.js";

const JWT_SECRET = process.env.JWT_SECRET;

// 🔹 Register a new user
export const registerUser = async (req, res) => {
  const { name, email, password } = req.body;

  try {
    // Check if user exists
    const { data: existingUser, error: findError } = await supabase
      .from("user")
      .select("*")
      .eq("email", email)
      .single();
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data: newUser, error: createError } = await supabase
      .from("user")
      .insert([
        { name, email, password: hashedPassword, role: "customer" }
      ])
      .select()
      .single();
    if (createError) throw createError;

    const token = jwt.sign(
      { userId: newUser.id, role: newUser.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Set HttpOnly auth cookie so Next.js middleware and backend can read it
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      ok: true,
      token,
      user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// 🔹 Login user
export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!JWT_SECRET) {
    return res.status(500).json({ message: "JWT_SECRET not set in environment" });
  }

  try {
    // Check if user exists
    const { data: user, error: findError } = await supabase
      .from("user")
      .select("*")
      .eq("email", email)
      .single();
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Compare the provided password with the hashed password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, role: user.role, isAdmin: user.role === "admin" },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Set HttpOnly auth cookie so Next.js middleware and backend can read it
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      ok: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isAdmin: user.role === "admin",
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// 🔹 Promote User to Admin (Admin-Only)
export const promoteToAdmin = async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied: Admins only" });
    }

    const { data: updatedUser, error } = await supabase
      .from("user")
      .update({ role: "admin" })
      .eq("id", userId)
      .select()
      .single();
    if (error) throw error;

    res.json({ message: "User promoted to admin", user: updatedUser });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};