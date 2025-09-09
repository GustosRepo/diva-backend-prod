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

const isAdminMiddleware = (req, res, next) => {
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

    if (!decoded || decoded.role !== "admin") {
      return res.status(403).json({ error: "Forbidden: admins only" });
    }

    req.user = decoded;
    return next();
  } catch (error) {
    const msg = error && error.name === "TokenExpiredError"
      ? "Unauthorized: token expired"
      : "Unauthorized: invalid token";
    return res.status(401).json({ error: msg });
  }
};

export default isAdminMiddleware;