import express from "express";
import supabase from "../../supabaseClient.js";

const router = express.Router();

// Middleware to verify admin access for write operations
const verifyAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.split(' ')[1];
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    
    if (!payload.isAdmin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.user = payload;
    next();
  } catch (error) {
    console.error("Admin verification error:", error);
    return res.status(401).json({ error: "Invalid token" });
  }
};

// Initialize blog_posts table if it doesn't exist
const initializeBlogTable = async () => {
  try {
    // Try to create table (will fail silently if exists)
    await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS blog_posts (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          excerpt TEXT NOT NULL,
          content TEXT NOT NULL,
          image VARCHAR(500),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `
    });
    console.log("✅ Blog table initialized");
  } catch (error) {
    // Table might already exist or we need to use direct SQL
    console.log("Blog table setup - using direct queries");
  }
};

// Initialize table on startup
initializeBlogTable();

// GET /api/blog - Get all blog posts (public)
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("blog")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching blog posts:", error);
      return res.status(500).json({ error: "Failed to fetch blog posts" });
    }

    res.json(data || []);
  } catch (error) {
    console.error("Blog fetch error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/blog/:id - Get single blog post (public)
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from("blog")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      console.error("Error fetching blog post:", error);
      return res.status(404).json({ error: "Blog post not found" });
    }

    res.json(data);
  } catch (error) {
    console.error("Blog fetch error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/blog - Create new blog post (admin only)
router.post("/", verifyAdmin, async (req, res) => {
  try {
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: "Title and content are required" });
    }

    const { data, error } = await supabase
      .from("blog")
      .insert([{
        title,
        content
      }])
      .select()
      .single();

    if (error) {
      console.error("Error creating blog post:", error);
      return res.status(500).json({ error: "Failed to create blog post" });
    }

    res.status(201).json(data);
  } catch (error) {
    console.error("Blog creation error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/blog/:id - Update blog post (admin only)
router.put("/:id", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: "Title and content are required" });
    }

    const { data, error } = await supabase
      .from("blog")
      .update({
        title,
        content
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Error updating blog post:", error);
      return res.status(500).json({ error: "Failed to update blog post" });
    }

    res.json(data);
  } catch (error) {
    console.error("Blog update error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/blog/:id - Delete blog post (admin only)
router.delete("/:id", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from("blog")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Error deleting blog post:", error);
      return res.status(500).json({ error: "Failed to delete blog post" });
    }

    res.json({ message: "Blog post deleted successfully" });
  } catch (error) {
    console.error("Blog deletion error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
