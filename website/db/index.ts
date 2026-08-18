import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  // Cloudflare supplies `env` through the worker runtime. Reading it from
  // globalThis keeps the shared data layer buildable on Vercel as well; the
  // Vercel demo uses dummy telemetry and never needs a D1 binding.
  const runtimeEnv = (globalThis as typeof globalThis & { env?: { DB?: D1Database } }).env;

  if (!runtimeEnv?.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(runtimeEnv.DB, { schema });
}
