import supabase from "../../supabaseClient.js";

// Get total users, orders, and revenue
export const getAnalytics = async (req, res) => {
  try {
    const { count: totalUsers, error: userError } = await supabase.from("user").select("id", { count: "exact", head: true });
    if (userError) throw userError;
    const { count: totalOrders, error: orderError } = await supabase.from("order").select("id", { count: "exact", head: true });
    if (orderError) throw orderError;
    const { data: revenueData, error: revenueError } = await supabase
      .from("order")
      .select("total_amount")
      .not("total_amount", "is", null);
    if (revenueError) throw revenueError;
    const totalRevenue = revenueData.reduce((sum, o) => sum + (o.total_amount || 0), 0);
    res.json({ totalUsers, totalOrders, totalRevenue });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get sales by date (for charts)
export const getSalesByDate = async (req, res) => {
  try {
    const { data: salesData, error } = await supabase
      .from("order")
      .select("created_at, total_amount")
      .order("created_at", { ascending: true });
    if (error) throw error;
    // Group by date
    const grouped = {};
    salesData.forEach((sale) => {
      const date = sale.created_at.split("T")[0];
      if (!grouped[date]) grouped[date] = 0;
      grouped[date] += sale.total_amount || 0;
    });
    const formattedData = Object.entries(grouped).map(([date, revenue]) => ({ date, revenue }));
    res.json(formattedData);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};