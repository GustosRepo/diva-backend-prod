import express from "express";
import { sendEmailHandler } from "../controllers/emailController.js"; // Import function correctly

const router = express.Router();

router.post("/send", sendEmailHandler); // Pass the function correctly

export default router;