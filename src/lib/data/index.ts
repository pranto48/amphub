// Picks the active backend at runtime based on VITE_BACKEND_MODE.
//   "supabase" (default) — Lovable Cloud / Supabase
//   "rest"              — Express + Postgres + WebSocket (Docker deployment)
import type { DataClient } from "./types";
import { supabaseAdapter } from "./supabase-adapter";
import { restAdapter } from "./rest-adapter";

const mode = (import.meta.env.VITE_BACKEND_MODE as string | undefined) ?? "supabase";

export const dataClient: DataClient = mode === "rest" ? restAdapter : supabaseAdapter;
export const backendMode = mode;
export type { DataClient } from "./types";
export * from "./types";
