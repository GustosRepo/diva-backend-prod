// isAdminMiddleware.js - Fixed import path
import jwt from "jsonwebtoken";
import supabase from "../../supabaseClient.js";  // Fixed: Go up two levels from middleware folder

const JWT_SECRET = process.env.JWT_SECRET;

const getTokenFromRequest = (req) => {
  const authHeader = req.header("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }
  return null;
};

const isAdminMiddleware = async (req, res, next) => {
  if (!JWT_SECRET) {
    console.error("JWT_SECRET is not set. Refusing to process auth.");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: missing token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId || decoded.id || decoded.sub;
    
    if (!userId) {
      return res.status(401).json({ error: "Invalid token structure" });
    }

    // Fetch user from database
    const { data: user, error } = await supabase
      .from("user")
      .select("id, email, role, is_admin")
      .eq("id", userId)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: "User not found" });
    }

    // Check BOTH conditions - role='admin' OR is_admin=true
    if (user.role !== "admin" && !user.is_admin) {
      return res.status(403).json({ error: "Forbidden: admins only" });
    }

    // Set req.user with all necessary fields
    req.user = {
      userId: user.id,
      email: user.email,
      role: user.role || (user.is_admin ? "admin" : "customer"),
      is_admin: user.is_admin
    };
    
    return next();
    
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Unauthorized: token expired" });
    }
    return res.status(401).json({ error: "Unauthorized: invalid token" });
  }
};

export default isAdminMiddleware;