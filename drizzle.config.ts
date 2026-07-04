import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations run from a trusted environment (local / CI) directly
    // against Neon — never through the Worker.
    url: process.env.DATABASE_URL ?? "",
  },
});
