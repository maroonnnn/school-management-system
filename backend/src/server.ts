
import "dotenv/config";
import app from "./app.js";
import pool from "./config/database.js";

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // اختبار الاتصال بقاعدة البيانات
    const result = await pool.query("SELECT NOW() AS current_time");

    console.log("Database connection successful!");
    console.log("Database server time:", result.rows[0].current_time);

    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });

  } catch (error) {
    console.error("Database connection failed:", error);
    process.exit(1);
  }
}

startServer();
