import sendEmail from "../services/emailServices.js"; // or .ts if you're using TypeScript

export const sendEmailHandler = async (req, res) => {
  const { to, subject, text, replyTo } = req.body;

  if (!to || !subject || !text) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    await sendEmail(to, subject, text, replyTo); // Pass replyTo here
    res.json({ success: true, message: "Email sent successfully!" });
  } catch (error) {
    console.error("❌ Email Sending Error:", error);
    res
      .status(500)
      .json({ error: "Failed to send email", details: error.message });
  }
};
