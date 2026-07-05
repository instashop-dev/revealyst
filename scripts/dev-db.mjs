// Dev-only Postgres: PGlite behind a wire-protocol socket so `wrangler dev`
// can hit a real(ish) database with zero external credentials.
//   node scripts/dev-db.mjs   → postgres://postgres:postgres@127.0.0.1:5432/postgres
// Applies the drizzle migrations on boot. Data is in-memory, gone on exit.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const db = await PGlite.create();

const migrationsDir = "drizzle";
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
for (const file of migrations) {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    await db.exec(statement);
  }
  console.log(`applied ${file}`);
}

// maxConnections defaults to 1 and the net server RESETS the overflow, so
// any overlapping request pair (per-request clients idle-linger 20s) dies
// with ECONNRESET. Queries serialize through the shared query queue anyway;
// allow a normal dev-request burst.
const server = new PGLiteSocketServer({
  db,
  port: 5432,
  host: "127.0.0.1",
  maxConnections: 16,
});
await server.start();
console.log(
  "dev db listening on postgres://postgres:postgres@127.0.0.1:5432/postgres",
);
