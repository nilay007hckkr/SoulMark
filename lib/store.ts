import { createHash, randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createAuthState, type AuthState } from "./auth";
import { createEvent, createLedger } from "./ledger";
import type { LedgerState } from "./types";

/**
 * Server-side persistence: small JSON files under ./data (git-ignored).
 * Each request loads, mutates and saves synchronously, so state stays consistent
 * across Next.js route bundles without a database.
 */

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const LEDGER_FILE = path.join(DATA_DIR, "ledger.json");
const AUTH_FILE = path.join(DATA_DIR, "auth.json");
const SECRETS_FILE = path.join(DATA_DIR, "secrets.json");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/** Missing file -> null. A file that exists but can't be parsed throws, so we never overwrite real data with a fresh state. */
function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`[soulmark] ${file} is corrupt — refusing to overwrite it. Fix or move the file, then restart.`);
  }
}

/** Atomic write: write a temp file, then rename it over the target. */
function writeJson(file: string, value: unknown) {
  ensureDir();
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1), "utf8");
  renameSync(tmp, file);
}

interface Secrets {
  qrSecret: string;
  organizerPin: string;
}

let warned = false;

/** Secrets come from .env; if missing, random values are generated once and kept in data/secrets.json. */
export function secrets(): Secrets {
  const stored = readJson<Secrets>(SECRETS_FILE);
  const generated: Secrets = stored ?? { qrSecret: randomBytes(32).toString("hex"), organizerPin: String(randomInt(100000, 1000000)) };
  if (!stored) writeJson(SECRETS_FILE, generated);
  const fromEnvPin = process.env.ORGANIZER_PIN?.trim();
  const fromEnvSecret = process.env.QR_SECRET?.trim();
  if (!warned && (!fromEnvPin || !fromEnvSecret)) {
    warned = true;
    console.warn(`[soulmark] ORGANIZER_PIN/QR_SECRET not set in .env — using generated values from ${SECRETS_FILE}. Organizer PIN: ${fromEnvPin || generated.organizerPin}`);
  }
  return { qrSecret: fromEnvSecret || generated.qrSecret, organizerPin: fromEnvPin || generated.organizerPin };
}

export function issuer() {
  const name = (process.env.ORGANIZER_NAME || "SoulMark Demo Org").slice(0, 60);
  const address = "0x" + createHash("sha256").update(`issuer:${secrets().qrSecret}`).digest("hex").slice(0, 40);
  return { name, address };
}

let demoWarned = false;

/** Fail closed: the sign-in key is only shown on screen when DEMO_MODE=true is set explicitly. */
export function demoMode(): boolean {
  const on = (process.env.DEMO_MODE ?? "").trim().toLowerCase() === "true";
  if (on && !demoWarned) {
    demoWarned = true;
    console.warn("[soulmark] DEMO_MODE=true: sign-in keys are shown on screen. Anyone can sign in as any email. Do not use for real events.");
  }
  return on;
}

export function loadLedger(): LedgerState {
  const existing = readJson<LedgerState>(LEDGER_FILE);
  if (existing && Array.isArray(existing.blocks) && existing.blocks.length > 0) return existing;
  const now = new Date();
  const state = createLedger(now);
  // Pre-created demo event so the demo works even on bad venue Wi-Fi.
  createEvent(
    state,
    { name: "Vibeathon Round 1", date: now.toISOString().slice(0, 10), venue: "Graphic Era, Dehradun", description: "Demo event created on first start.", claimMinutes: 7 * 24 * 60 },
    issuer(),
    now,
  );
  writeJson(LEDGER_FILE, state);
  return state;
}

export function saveLedger(state: LedgerState) {
  writeJson(LEDGER_FILE, state);
}

export function loadAuth(): AuthState {
  return readJson<AuthState>(AUTH_FILE) ?? createAuthState();
}

export function saveAuth(state: AuthState) {
  writeJson(AUTH_FILE, state);
}
