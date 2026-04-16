import { initDb } from "./client.js";

async function main() {
  try {
    await initDb();
    console.log("[DB] Schema initialized successfully");
    process.exit(0);
  } catch (err) {
    console.error("[DB] Failed to initialize schema:", err);
    process.exit(1);
  }
}

main();
