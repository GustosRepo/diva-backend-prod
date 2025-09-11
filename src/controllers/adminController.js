import supabase from "../../supabaseClient.js";
import bcrypt from "bcryptjs";

// Helpers for parsing form values
const parseBool = (v, fallback = false) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true") return true;
    if (t === "false") return false;
    try { return JSON.parse(v); } catch { /* ignore */ }
  }
  return fallback;
};

const parseNum = (v, fallback = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const ALLOWED_BRANDS = new Set(["nails", "toys", "accessories"]);

// 🔹 Get All Users (Admin Only)
export const getAllUsers = async (req, res) => {
  try {
    let { page = 1, limit = 10 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);

    if (isNaN(page) || isNaN(limit) || page < 1 || limit < 1) {
      return res
        .status(400)
        .json({ message: "Page and limit must be positive numbers." });
    }

    const { count: totalUsers, error: countError } = await supabase
      .from("user")
      .select("id", { count: "exact", head: true });
    if (countError) throw countError;
    const { data: users, error } = await supabase
      .from("user")
      .select("id, email, role, created_at")
      .range((page - 1) * limit, page * limit - 1);
    if (error) throw error;

    res.json({
      page,
      limit,
      totalUsers,
      totalPages: Math.ceil(totalUsers / limit),
      users,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching users", error: error.message });
  }
};

// 🔹 Update User Role (Admin Only)
export const updateUserRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    // Validate role
    if (!["admin", "customer"].includes(role)) {
      return res
        .status(400)
        .json({ message: "Invalid role. Must be 'admin' or 'customer'." });
    }

    // ✅ Ensure user exists
    const { data: user, error: findError } = await supabase
      .from("user")
      .select("*")
      .eq("id", userId)
      .single();
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // ✅ Update user role
    const { data: updatedUser, error } = await supabase
      .from("user")
      .update({ role })
      .eq("id", userId)
      .select()
      .single();
    if (error) throw error;

    res.json({ message: `User role updated to ${role}`, user: updatedUser });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error updating user role", error: error.message });
  }
};

// 🔹 Delete a User (Admin Only)
export const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.user.userId === userId) {
      return res.status(403).json({ message: "You cannot delete yourself." });
    }

    const { error } = await supabase.from("user").delete().eq("id", userId);
    if (error) throw error;

    res.json({ message: "User deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error deleting user", error: error.message });
  }
};

export const getAdminDashboardStats = async (req, res) => {
  try {
    const { count: totalUsers, error: userError } = await supabase
      .from("user")
      .select("id", { count: "exact", head: true });
    if (userError) throw userError;
    const { count: totalOrders, error: orderError } = await supabase
      .from("order")
      .select("id", { count: "exact", head: true });
    if (orderError) throw orderError;
    const { data: revenueData, error: revenueError } = await supabase
      .from("order")
      .select("total_amount")
      .not("total_amount", "is", null);
    if (revenueError) throw revenueError;
    const totalRevenue = revenueData.reduce(
      (sum, o) => sum + (o.total_amount || 0),
      0
    );
    res.json({ totalUsers, totalOrders, totalRevenue });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching admin stats", error: error.message });
  }
};

const mapAdminProductRow = (row) => {
  if (!row) return row;
  return {
    ...row,
    bestSeller: row.best_seller,
    brandSegment: row.brand_segment || row.brandSegment,
    categorySlug: row.category_slug || row.categorySlug,
  };
};

export const addProduct = async (req, res) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied: Admins only" });
    }

    const file = req.file || null;
    const {
      title,
      description = "",
      price,
      quantity = 0,
      brandSegment,
      brand_segment,
      categorySlug,
      category_slug,
      bestSeller,
      best_seller,
      weightOz,
      lengthIn,
      widthIn,
      heightIn,
    } = req.body || {};

    if (!title) return res.status(400).json({ message: "Title is required" });
    const priceNum = parseNum(price);
    if (priceNum === null) return res.status(400).json({ message: "Price must be a number" });
    const qtyNum = parseNum(quantity, 0);

    const effectiveBrand = (brandSegment || brand_segment || "").trim().toLowerCase();
    if (effectiveBrand && !ALLOWED_BRANDS.has(effectiveBrand)) {
      return res.status(400).json({ message: `brand_segment invalid. Allowed: ${Array.from(ALLOWED_BRANDS).join(", ")}` });
    }
    const effectiveCategory = (categorySlug || category_slug || "").trim().toLowerCase();
    if (!effectiveCategory) return res.status(400).json({ message: "category_slug is required" });

    // Image is required for now (aligns with your admin form)
    if (!file) return res.status(400).json({ message: "Image file is required" });
    if (!file.buffer) {
      return res.status(500).json({ message: "Upload error: file buffer missing. Ensure multer.memoryStorage() is used." });
    }

    const bucket = process.env.SUPABASE_BUCKET || "divasDB/uploads";
    const ext = (file.mimetype?.split("/")?.[1] || "jpg").toLowerCase();
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const storagePath = filename;

    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(storagePath, file.buffer, { contentType: file.mimetype || "image/jpeg", upsert: false });
    if (upErr) {
      console.error("[addProduct] storage upload error:", upErr);
      return res.status(500).json({ message: "Failed to upload image", details: upErr.message });
    }
    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(storagePath);
    const imageUrl = pub?.publicUrl || null;

    const row = {
      title,
      description,
      price: priceNum,
      quantity: qtyNum,
      brand_segment: effectiveBrand,
      category_slug: effectiveCategory,
      best_seller: parseBool(bestSeller ?? best_seller, false),
      image: imageUrl,
      ...(parseNum(weightOz) != null ? { weight_oz: parseNum(weightOz) } : {}),
      ...(parseNum(lengthIn) != null ? { length_in: parseNum(lengthIn) } : {}),
      ...(parseNum(widthIn)  != null ? { width_in:  parseNum(widthIn)  } : {}),
      ...(parseNum(heightIn) != null ? { height_in: parseNum(heightIn) } : {}),
    };

    const { data: inserted, error: insErr } = await supabase
      .from("product")
      .insert(row)
      .select("*")
      .single();

    if (insErr) {
      console.error("[addProduct] supabase insert error:", insErr);
      return res.status(500).json({ message: "Insert failed", details: insErr.message });
    }

    return res.status(201).json(mapAdminProductRow(inserted));
  } catch (error) {
    console.error("[addProduct] unexpected error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const getAllProducts = async (req, res) => {
  try {
    let {
      categoryId,
      minPrice,
      maxPrice,
      search,
      sort,
      page = 1,
      limit = 10,
      brand_segment,
      brandSegment,
      category: categorySlug,
      category_slug,
      categorySlug: qsCategorySlug,
    } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);

    if (isNaN(page) || isNaN(limit) || page < 1 || limit < 1) {
      return res
        .status(400)
        .json({ message: "Page and limit must be positive numbers." });
    }

    const effectiveBrand = (brand_segment || brandSegment || "").trim();
    const effectiveCategorySlug =
      (categorySlug || category_slug || qsCategorySlug || "").trim();

    // Removed category join because category_id is not set (using slug approach)
    let query = supabase.from("product").select("*");
    if (categoryId) query = query.eq("category_id", categoryId);
    if (effectiveBrand)
      query = query.eq("brand_segment", effectiveBrand.toLowerCase());
    if (effectiveCategorySlug)
      query = query.eq(
        "category_slug",
        effectiveCategorySlug.toLowerCase()
      );
    if (minPrice) query = query.gte("price", parseFloat(minPrice));
    if (maxPrice) query = query.lte("price", parseFloat(maxPrice));
    if (search) query = query.ilike("title", `%${search}%`);

    if (sort === "price_asc")
      query = query.order("price", { ascending: true });
    else if (sort === "price_desc")
      query = query.order("price", { ascending: false });
    else query = query.order("created_at", { ascending: false });

    query = query.range((page - 1) * limit, page * limit - 1);

    const { data: products, error } = await query;
    if (error) throw error;

    // Count with filters
    let countQuery = supabase
      .from("product")
      .select("id", { count: "exact", head: true });
    if (categoryId) countQuery = countQuery.eq("category_id", categoryId);
    if (effectiveBrand)
      countQuery = countQuery.eq(
        "brand_segment",
        effectiveBrand.toLowerCase()
      );
    if (effectiveCategorySlug)
      countQuery = countQuery.eq(
        "category_slug",
        effectiveCategorySlug.toLowerCase()
      );
    if (minPrice) countQuery = countQuery.gte("price", parseFloat(minPrice));
    if (maxPrice) countQuery = countQuery.lte("price", parseFloat(maxPrice));
    if (search) countQuery = countQuery.ilike("title", `%${search}%`);

    const { count: totalProducts, error: countError } = await countQuery;
    if (countError) throw countError;

    res.json({
      page,
      limit,
      totalProducts,
      totalPages: Math.ceil(totalProducts / limit),
      products: (products || []).map(mapAdminProductRow),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const updateProduct = async (req, res) => {
  const { id } = req.params;
  const {
    title,
    description,
    price,
    bestSeller,
    quantity,
    brandSegment,
    brand_segment,
    categorySlug,
    category_slug,
  } = req.body;
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied: Admins only" });
    }
    let effectiveBrandSegment = (brandSegment || brand_segment || "")
      .trim()
      .toLowerCase();
    let effectiveCategorySlug = (categorySlug || category_slug || "")
      .trim()
      .toLowerCase();

    let uploadedImageUrl;
    if (req.file) {
      if (!req.file.buffer) {
        return res.status(500).json({ message: "Upload error: file buffer missing. Ensure multer.memoryStorage() is used." });
      }
      const bucket = process.env.SUPABASE_BUCKET || "divasDB/uploads";
      const ext = (req.file.mimetype?.split("/")?.[1] || "jpg").toLowerCase();
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const storagePath = filename;
      const { error: upErr } = await supabase.storage
        .from(bucket)
        .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype || "image/jpeg", upsert: false });
      if (upErr) {
        console.error("[updateProduct] storage upload error:", upErr);
        return res.status(500).json({ message: "Failed to upload image", details: upErr.message });
      }
      const { data: pub } = supabase.storage.from(bucket).getPublicUrl(storagePath);
      uploadedImageUrl = pub?.publicUrl || undefined;
    }

    const updateData = {
      ...(title != null ? { title } : {}),
      ...(description != null ? { description } : {}),
      ...(price != null ? { price: parseFloat(price) } : {}),
      ...(bestSeller != null ? { best_seller: parseBool(bestSeller) } : {}),
      ...(quantity != null ? { quantity: parseInt(quantity, 10) } : {}),
      ...(uploadedImageUrl ? { image: uploadedImageUrl } : {}),
      ...(effectiveBrandSegment ? { brand_segment: effectiveBrandSegment } : {}),
      ...(effectiveCategorySlug ? { category_slug: effectiveCategorySlug } : {}),
    };

    // Removed category join in select
    const { data: updatedProduct, error } = await supabase
      .from("product")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    res.json(mapAdminProductRow(updatedProduct));
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error updating product", error: error.message });
  }
};

// 🔹 Reset User Password (Admin Only)
export const resetUserPassword = async (req, res) => {
  try {
    // Admin-only guard (route is also gated by middleware)
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied: Admins only" });
    }

    const { userId } = req.params;
    const { newPassword } = req.body || {};

    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
      return res.status(400).json({ message: "newPassword must be at least 8 characters" });
    }

    // Ensure the user exists (and grab email for clarity in response)
    const { data: user, error: findErr } = await supabase
      .from("user")
      .select("id, email")
      .eq("id", userId)
      .single();

    if (findErr || !user) {
      return res.status(404).json({ message: "User not found (local lookup)" });
    }

    // Hash with bcrypt before storing
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(newPassword, salt);

    const { error: updErr } = await supabase
      .from("user")
      .update({ password: hashed, updated_at: new Date().toISOString() })
      .eq("id", userId);

    if (updErr) {
      console.error("[resetUserPassword] update error:", updErr);
      return res.status(500).json({ message: "Failed to update password" });
    }

    return res.json({ success: true, method: "db-update", userId: user.id, email: user.email || null });
  } catch (error) {
    console.error("[resetUserPassword] unhandled error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};