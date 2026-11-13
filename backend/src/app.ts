
import express from "express";
import cors from "cors";
import helmet from "helmet";

import reportsRoutes from "./routes/reports.routes.js";
import authRoutes from "./routes/auth.routes.js";
import requestsRoutes from "./routes/requests.routes.js";

const app = express();

// Security middleware
app.use(helmet());

// Allow frontend communication
app.use(
  cors({
    origin: "http://localhost:5173",
  })
);

// Parse JSON requests
app.use(express.json());

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/requests", requestsRoutes);

// Test route
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "School Management API is running successfully",
  });
});

export default app;
