import jwt from "jsonwebtoken";

export default function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log("[authMiddleware] No or malformed Authorization header:", authHeader);
    return res.status(401).json({ message: "No token provided" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Patch: support userId in JWT payload
    if (decoded.userId && !decoded.id) {
      decoded.id = decoded.userId;
    }
    console.log("[authMiddleware] Decoded JWT:", decoded);
    req.user = decoded;
    next();
  } catch (err) {
    console.error("[authMiddleware] JWT verification failed:", err.message);
    return res.status(401).json({ message: "Invalid token" });
  }
}