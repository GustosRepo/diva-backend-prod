import supabase from "../../supabaseClient.js";

const ALLOWED_BRANDS = new Set(["nails", "toys", "accessories"]);

const mapCategory = (row) => row ? ({
  ...row,
  brandSegment: row.brand_segment || row.brandSegment,
}) : row;

// Get All Categories
export const getAllCategories = async (req, res) => {
  try {
    const { brand_segment, brandSegment } = req.query;
    let query = supabase.from("category").select("id, name, slug, brand_segment, description").order('name');
    const effectiveBrand = (brand_segment || brandSegment || '').trim();
    if (effectiveBrand) query = query.eq('brand_segment', effectiveBrand.toLowerCase());
    const { data: categories, error } = await query;
    if (error) throw error;
    res.json(categories.map(mapCategory));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Add a New Category (Admin Only) - brand_segment & slug now REQUIRED per DB schema
export const addCategory = async (req, res) => {
  const { name, slug, brandSegment, brand_segment, description } = req.body;
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied: Admins only" });
    }
    if (!name) return res.status(400).json({ message: 'name required' });
    let finalSlug = (slug || name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
    const finalBrand = (brandSegment || brand_segment || '').toLowerCase().trim();
    if (!finalBrand) return res.status(400).json({ message: 'brandSegment required' });
    if (!ALLOWED_BRANDS.has(finalBrand)) {
      return res.status(400).json({ message: 'Invalid brandSegment' });
    }
    if (!finalSlug) return res.status(400).json({ message: 'slug required' });
    const { data: category, error } = await supabase.from("category")
      .insert([{ name, slug: finalSlug, brand_segment: finalBrand, description: description || '' }])
      .select("id, name, slug, brand_segment, description")
      .single();
    if (error) throw error;
    res.status(201).json(mapCategory(category));
  } catch (error) {
    res.status(500).json({ message: "Error adding category", error: error.message });
  }
};

export const updateCategory = async (req, res) => {
  const { id } = req.params;
  const { name, slug, brandSegment, brand_segment, description } = req.body;
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied: Admins only" });
    }
    const updateData = {
      ...(name != null ? { name } : {}),
      ...(slug != null ? { slug: slug.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') } : {}),
      ...(brandSegment != null || brand_segment != null ? { brand_segment: (brandSegment || brand_segment || '').toLowerCase().trim() } : {}),
      ...(description != null ? { description } : {}),
    };
    if (updateData.brand_segment && !ALLOWED_BRANDS.has(updateData.brand_segment)) {
      return res.status(400).json({ message: 'Invalid brandSegment' });
    }
    // If slug provided ensure non-empty after normalization
    if (updateData.slug === '') {
      return res.status(400).json({ message: 'Invalid slug' });
    }
    const { data: updatedCategory, error } = await supabase.from("category")
      .update(updateData)
      .eq("id", id)
      .select("id, name, slug, brand_segment, description")
      .single();
    if (error) throw error;
    res.json(mapCategory(updatedCategory));
  } catch (error) {
    res.status(500).json({ message: "Error updating category", error: error.message });
  }
};

// Delete a Category (Admin Only)
export const deleteCategory = async (req, res) => {
  const { id } = req.params;
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied: Admins only" });
    }
    const { count, error: countError } = await supabase.from("product").select("id", { count: "exact", head: true }).eq("category_id", id);
    if (countError) throw countError;
    if (count > 0) {
      return res.status(400).json({ message: "Cannot delete category with existing products." });
    }
    const { error } = await supabase.from("category").delete().eq("id", id);
    if (error) throw error;
    res.json({ message: "Category deleted" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting category", error: error.message });
  }
};