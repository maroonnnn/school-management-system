
import { Router } from "express";

import {
  getMonthlyReport,
  getMonthlyDetailedReportController
} from "../controllers/reports.controller.js";

const router = Router();

router.get("/monthly", getMonthlyReport);

router.get("/monthly/detailed", getMonthlyDetailedReportController);

export default router;
