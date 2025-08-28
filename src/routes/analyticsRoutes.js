import express from "express";
import { getAnalytics, getSalesByDate } from "../controllers/analyticsController.js";

const router = express.Router();

router.get("/", getAnalytics); // 📊 Get overall analytics
router.get("/sales", getSalesByDate); // 📈 Get sales data for charts

export default router;