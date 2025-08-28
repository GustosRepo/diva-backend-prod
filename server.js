// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import path from "path";

// ✅ Must be imported first to mount BEFORE body parsing
import webhookRoutes from "./src/routes/webhookRoutes.js";

const app = express();

// When running behind a proxy (DigitalOcean App Platform / load balancers)
// trust proxy so req.ip and secure cookies work correctly.
app.set("trust proxy", true);

// Diagnostic request logger (temporary) – logs every incoming request
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl}`);
  next();
});

// 🛑 RAW BODY MIDDLEWARE FIRST — broaden type in case of content-type variance
app.use("/api/webhooks/stripe", express.raw({ type: () => true }), webhookRoutes);

// ✅ Other middleware BELOW raw webhook handler
// Allow the frontend origin to be configured via environment (Vercel URL).
const FRONTEND_ORIGIN = process.env.CLIENT_URL || process.env.FRONTEND_URL || "http://localhost:3000";
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json()); // This parses body — cannot go above webhook!
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Simple health check (useful for load-balancers / DigitalOcean health probes)
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

// ✅ Other routes
import authRoutes from "./src/routes/auth.js";
import orderRoutes from "./src/routes/orderRoutes.js";
import categoryRoutes from "./src/routes/categoryRoute.js";
import productRoutes from "./src/routes/productRoutes.js";
import adminRoutes from "./src/routes/adminRoutes.js";
import userRoutes from "./src/routes/userRoutes.js";
import checkoutRoutes from "./src/routes/checkout.js";
import emailRoutes from "./src/routes/emailRoutes.js";
import analyticsRoutes from "./src/routes/analyticsRoutes.js";
import blogRoutes from "./src/routes/blogRoutes.js";
import popupEventRoutes from "./src/routes/popupEventRoutes.js";

app.use("/auth", authRoutes);
app.use("/orders", orderRoutes);
app.use("/categories", categoryRoutes);
app.use("/products", productRoutes);
app.use("/admin", adminRoutes);
app.use("/users", userRoutes);
app.use("/checkout", checkoutRoutes);
app.use("/email", emailRoutes);
app.use("/analytics", analyticsRoutes);
app.use("/api/blog", blogRoutes);
app.use("/api/popup-events", popupEventRoutes);

// ✅ Health route
app.get("/protected", (req, res) => {
  res.json({ message: "You are authenticated" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));