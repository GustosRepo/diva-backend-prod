import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

// Extract JWT from either Authorization header (Bearer) or HttpOnly cookie named "token"
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

export default function authMiddleware(req, res, next) {
  if (!JWT_SECRET) {
    console.error("JWT_SECRET not set");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: missing token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Normalize payload: support userId -> id
    if (decoded.userId && !decoded.id) {
      decoded.id = decoded.userId;
    }
    req.user = decoded;
    return next();
  } catch (err) {
    const msg = err && err.name === "TokenExpiredError"
      ? "Unauthorized: token expired"
      : "Unauthorized: invalid token";
    return res.status(401).json({ error: msg });
  }
}
