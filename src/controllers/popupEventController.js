import supabase from "../../supabaseClient.js";

// 🔹 Get all popup events (Public)
export const getAllPopupEvents = async (req, res) => {
  try {
    const { data: events, error } = await supabase
      .from("popup_events")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: events,
      message: "Events fetched successfully"
    });
  } catch (error) {
    console.error("❌ Error fetching popup events:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching popup events",
      error: error.message
    });
  }
};

// 🔹 Create new popup event (Admin only)
export const createPopupEvent = async (req, res) => {
  try {
    const { title, description, emoji } = req.body;

    // Validation
    if (!title || !description || !emoji) {
      return res.status(400).json({
        success: false,
        message: "Title, description, and emoji are required"
      });
    }

    if (title.length > 255) {
      return res.status(400).json({
        success: false,
        message: "Title must be 255 characters or less"
      });
    }

    if (emoji.length > 10) {
      return res.status(400).json({
        success: false,
        message: "Emoji must be 10 characters or less"
      });
    }

    const { data: newEvent, error } = await supabase
      .from("popup_events")
      .insert([{
        title: title.trim(),
        description: description.trim(),
        emoji: emoji.trim()
      }])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      data: newEvent,
      message: "Event created successfully"
    });
  } catch (error) {
    console.error("❌ Error creating popup event:", error);
    res.status(500).json({
      success: false,
      message: "Error creating popup event",
      error: error.message
    });
  }
};

// 🔹 Update popup event (Admin only)
export const updatePopupEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, emoji } = req.body;

    // Validation
    if (!title || !description || !emoji) {
      return res.status(400).json({
        success: false,
        message: "Title, description, and emoji are required"
      });
    }

    if (title.length > 255) {
      return res.status(400).json({
        success: false,
        message: "Title must be 255 characters or less"
      });
    }

    if (emoji.length > 10) {
      return res.status(400).json({
        success: false,
        message: "Emoji must be 10 characters or less"
      });
    }

    // Check if event exists
    const { data: existingEvent, error: fetchError } = await supabase
      .from("popup_events")
      .select("id")
      .eq("id", id)
      .single();

    if (fetchError || !existingEvent) {
      return res.status(404).json({
        success: false,
        message: "Event not found"
      });
    }

    const { data: updatedEvent, error } = await supabase
      .from("popup_events")
      .update({
        title: title.trim(),
        description: description.trim(),
        emoji: emoji.trim(),
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data: updatedEvent,
      message: "Event updated successfully"
    });
  } catch (error) {
    console.error("❌ Error updating popup event:", error);
    res.status(500).json({
      success: false,
      message: "Error updating popup event",
      error: error.message
    });
  }
};

// 🔹 Delete popup event (Admin only)
export const deletePopupEvent = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if event exists
    const { data: existingEvent, error: fetchError } = await supabase
      .from("popup_events")
      .select("id")
      .eq("id", id)
      .single();

    if (fetchError || !existingEvent) {
      return res.status(404).json({
        success: false,
        message: "Event not found"
      });
    }

    const { error } = await supabase
      .from("popup_events")
      .delete()
      .eq("id", id);

    if (error) throw error;

    res.json({
      success: true,
      message: "Event deleted successfully"
    });
  } catch (error) {
    console.error("❌ Error deleting popup event:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting popup event",
      error: error.message
    });
  }
};

// 🔹 Get single popup event (Public)
export const getPopupEventById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: event, error } = await supabase
      .from("popup_events")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !event) {
      return res.status(404).json({
        success: false,
        message: "Event not found"
      });
    }

    res.json({
      success: true,
      data: event,
      message: "Event fetched successfully"
    });
  } catch (error) {
    console.error("❌ Error fetching popup event:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching popup event",
      error: error.message
    });
  }
};
