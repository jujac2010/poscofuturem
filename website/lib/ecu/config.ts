import type { RunMode } from "./types";

export function getRunMode(): RunMode {
  const raw = (import.meta.env.VITE_RUN_MODE ?? "DUMMY").toUpperCase();
  if (raw === "DUMMY" || raw === "REAL") return raw;
  throw new Error(`Invalid RUN_MODE: ${raw}. Use DUMMY or REAL.`);
}
