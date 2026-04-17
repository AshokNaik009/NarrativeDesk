import pg from "pg";
import { config } from "../config.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function initDb(): Promise<void> {
  try {
    // Try to read schema.sql (exists in development, not in compiled production build)
    const schemaPath = join(__dirname, "schema.sql");
    const schema = readFileSync(schemaPath, "utf-8");
    await pool.query(schema);
    console.log("[DB] Schema initialized from file");
  } catch (err: any) {
    // If schema.sql doesn't exist (production after build), assume already initialized
    if (err.code === "ENOENT") {
      console.log("[DB] Schema file not found (production deployment), skipping initialization");
      return;
    }
    throw err;
  }
}

export async function getPool(): Promise<pg.Pool> {
  return pool;
}

export default pool;
