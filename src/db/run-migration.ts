import { readFileSync } from "fs";
import { query } from "./client.js";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: tsx src/db/run-migration.ts <path-to-sql-file>");
    process.exit(1);
  }
  const sql = readFileSync(file, "utf-8");
  console.log(`[migrate] applying ${file}`);
  try {
    await query(sql);
    console.log(`[migrate] ${file} applied successfully`);
    process.exit(0);
  } catch (err) {
    console.error(`[migrate] FAILED:`, err);
    process.exit(1);
  }
}

main();
