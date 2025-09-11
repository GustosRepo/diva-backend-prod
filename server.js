// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import path from "path";
import cookieParser from "cookie-parser";
import fs from "fs";
import { publicRouter as orderPublicRouter, adminRouter as orderAdminRouter } from "./src/routes/orderRoutes.js";


// ✅ Must be imported first to mount BEFORE body parsing
import webhookRoutes from "./src/routes/webhookRoutes.js";

const app = express();

// When running behind a proxy (DigitalOcean App Platform / load balancers)
// trust proxy so req.ip and secure cookies work correctly.
app.set("trust proxy", true);

// === STARTUP DIAGNOSTICS ===
console.log('\n=== SERVER STARTUP ===');
console.log('Current working directory:', process.cwd());
console.log('Admin routes file exists?', fs.existsSync('./src/routes/adminRoutes.js'));

// Diagnostic request logger (dev only)
if (process.env.NODE_ENV !== "production") {
  app.use((req, _res, next) => {
    console.log(`[REQ] ${req.method} ${req.originalUrl}`);
    next();
  });
}

// 🛑 RAW BODY MIDDLEWARE FIRST — broaden type in case of content-type variance
app.use("/api/webhooks/stripe", express.raw({ type: () => true }), webhookRoutes);

// ✅ Other middleware BELOW raw webhook handler
// Allow the frontend origin(s) to be configured via environment (comma-separated)
const FRONTEND_ORIGIN = process.env.CLIENT_URL || process.env.FRONTEND_URL || "http://localhost:3000";
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Known production/stage origins — add your domains here
const defaultAllowedOrigins = [
  FRONTEND_ORIGIN,
  "https://divacms-frontend-prod.vercel.app",
  "https://thedivefactory.com",
  "https://www.thedivefactory.com",
  "http://localhost:3000"
].filter(Boolean);

// Merge and de-dupe
const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...CORS_ALLOWED_ORIGINS]));

// Ensure caches don't serve CORS for a different Origin
app.use((req, res, next) => {
  res.setHeader("Vary", "Origin");
  next();
});

const corsOptions = {
  origin: function (origin, callback) {
    // Allow non-browser tools (no Origin) like curl/Postman and same-origin SSR
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
  maxAge: 86400, // cache preflight for 1 day
};

app.use(cors(corsOptions));
// Explicitly handle preflight for all routes
app.options("*", cors(corsOptions));
app.use(cookieParser());

app.use(express.json()); // This parses body — cannot go above webhook!
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Simple health check (useful for load-balancers / DigitalOcean health probes)
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

// === DETAILED REQUEST LOGGING FOR RESET-PASSWORD ===
app.use((req, res, next) => {
  if (req.path.includes('reset-password') || req.originalUrl.includes('reset-password')) {
    console.log(`\n[RESET-PASSWORD REQUEST]`);
    console.log(`  Method: ${req.method}`);
    console.log(`  Original URL: ${req.originalUrl}`);
    console.log(`  Path: ${req.path}`);
    console.log(`  Headers:`, {
      authorization: req.headers.authorization ? 'Present' : 'Missing',
      contentType: req.headers['content-type']
    });
  }
  next();
});

// === TEST ENDPOINT DIRECTLY ON APP ===
app.all('/admin/users/:userId/reset-password-test', (req, res) => {
  console.log('[DIRECT TEST ENDPOINT HIT]');
  res.json({
    message: 'Direct test endpoint hit!',
    method: req.method,
    userId: req.params.userId,
    path: req.path,
    originalUrl: req.originalUrl
  });
});

// ✅ Other routes
import authRoutes from "./src/routes/auth.js";
import { publicRouter as categoryPublicRoute, adminRouter as categoryAdminRoute } from "./src/routes/categoryRoute.js";
import productRoutes from "./src/routes/productRoutes.js";
import adminRoutes from "./src/routes/adminRoutes.js";
import userRoutes from "./src/routes/userRoutes.js";
import checkoutRoutes from "./src/routes/checkout.js";
import emailRoutes from "./src/routes/emailRoutes.js";
import analyticsRoutes from "./src/routes/analyticsRoutes.js";
import blogRoutes from "./src/routes/blogRoutes.js";
import popupEventRoutes from "./src/routes/popupEventRoutes.js";

app.use("/auth", authRoutes);
app.use("/orders", orderPublicRouter);
app.use("/admin/orders", orderAdminRouter);
app.use("/categories", categoryPublicRoute);
app.use("/admin/categories", categoryAdminRoute);
app.use("/products", productRoutes);
app.use("/admin", adminRoutes);
app.use("/users", userRoutes);
app.use("/checkout", checkoutRoutes);
app.use("/email", emailRoutes);
app.use("/analytics", analyticsRoutes);
app.use("/api/blog", blogRoutes);
app.use("/api/popup-events", popupEventRoutes);

// === LOG REGISTERED ADMIN ROUTES ===
console.log('\n=== ADMIN ROUTES REGISTERED ===');
if (adminRoutes && adminRoutes.stack) {
  adminRoutes.stack.forEach((layer) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase()).join(', ');
      console.log(`  ${methods.padEnd(10)} /admin${layer.route.path}`);
    }
  });
} else {
  console.log('  WARNING: adminRoutes.stack not accessible');
}
console.log('================================\n');

// ✅ Health route
app.get("/protected", (req, res) => {
  res.json({ message: "You are authenticated" });
});

// === 404 HANDLER WITH DIAGNOSTICS ===
app.use((req, res) => {
  if (req.path.includes('reset-password') || req.originalUrl.includes('reset-password')) {
    console.log(`\n[404 HANDLER] Could not find: ${req.method} ${req.originalUrl}`);
    console.log('[404] This request did not match any route');
    
    // Check if it's close to an admin route
    if (req.originalUrl.startsWith('/admin/users/')) {
      console.log('[404] This looks like it should match an admin route but didn\'t');
      console.log('[404] Expected pattern: /admin/users/:userId/reset-password');
      console.log('[404] Actual URL:', req.originalUrl);
      
      // Log what routes ARE registered
      console.log('[404] Currently registered admin routes:');
      if (adminRoutes && adminRoutes.stack) {
        adminRoutes.stack.forEach((layer) => {
          if (layer.route && layer.route.path.includes('reset-password')) {
            const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase()).join(', ');
            console.log(`      ${methods}: /admin${layer.route.path}`);
          }
        });
      }
    }
  }
  
  res.status(404).json({ 
    error: 'Route not found', 
    method: req.method,
    path: req.originalUrl 
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Admin password reset routes should be available at:`);
  console.log(`   PUT  http://localhost:${PORT}/admin/users/:userId/reset-password`);
  console.log(`   PATCH http://localhost:${PORT}/admin/users/:userId/reset-password`);
  console.log(`\n📍 Test endpoint available at:`);
  console.log(`   ALL  http://localhost:${PORT}/admin/users/test/reset-password-test`);
  console.log('\n=== Server ready for requests ===\n');
});