
import "dotenv/config";
import app from "./app.js";
import pool from "./config/database.js";

const PORT = process.env.PORT || 5000;

// Refuse to run with a guessable signing key outside local development (NFR-04)
const secret = process.env.JWT_SECRET ?? "";
if (secret.length < 32 || /^(change-me|secret|changeme)/i.test(secret)) {
  if (process.env.NODE_ENV === "production") {
    console.error("JWT_SECRET is missing, shorter than 32 characters, or a placeholder — refusing to start.");
    process.exit(1);
  }
  console.warn("WARNING: JWT_SECRET is weak. Set a random value of 32+ characters before deploying.");
}

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
