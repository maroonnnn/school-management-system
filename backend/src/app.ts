
import express from "express";
import cors from "cors";
import helmet from "helmet";

import reportsRoutes from "./routes/reports.routes.js";
import authRoutes from "./routes/auth.routes.js";
import requestsRoutes from "./routes/requests.routes.js";
import schoolsRoutes from "./routes/schools.routes.js";
import employeesRoutes from "./routes/employees.routes.js";
import academicsRoutes from "./routes/academics.routes.js";
import usersRoutes from "./routes/users.routes.js";
import gradesRoutes from "./routes/grades.routes.js";
import scheduleRoutes from "./routes/schedule.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import attendanceRoutes from "./routes/attendance.routes.js";
import faceRoutes from "./routes/face.routes.js";
import notificationsRoutes from "./routes/notifications.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import messagesRoutes from "./routes/messages.routes.js";

const app = express();

// Security middleware
app.use(helmet());

// Behind a reverse proxy (nginx in Docker) — use X-Forwarded-For for req.ip in the audit log
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);

// Allow frontend communication. In Docker the frontend is served from the same origin via nginx,
// so CORS only matters for local development (Vite on 5173). Comma-separated list.
app.use(
  cors({
    origin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((o) => o.trim()),
  })
);

// Parse JSON requests
// 6 MB: face check-in sends several camera frames as base64 JPEG
app.use(express.json({ limit: "6mb" }));

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/requests", requestsRoutes);
app.use("/api/schools", schoolsRoutes);
app.use("/api/employees", employeesRoutes);
app.use("/api/academics", academicsRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/grades", gradesRoutes);
app.use("/api/schedule", scheduleRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/face", faceRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/messages", messagesRoutes);

// Test route
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "School Management API is running successfully",
  });
});

export default app;
