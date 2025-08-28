import { body, validationResult } from "express-validator";

export const validateOrder = [
  body("userId").notEmpty().withMessage("User ID is required."),
  body("productId").notEmpty().withMessage("Product ID is required."),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  },
];

export const validateOrderStatus = [
  body("status")
    .isIn(["pending", "shipped", "delivered"])
    .withMessage("Invalid status. Allowed: pending, shipped, delivered."),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  },
];