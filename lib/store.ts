import { createHash, randomBytes, randomInt } from "node:crypto";
import type { AuthState } from "./auth";
import { dbPath, getMeta, readAuth, readLedger, readPresence, setMeta, writeAuth, writeLedger, writePresence } from "./db";
import { createEvent, createLedger } from "./ledger";
import type { PresenceState } from "./presence";
import type { LedgerState } from "./types";

/**
 * Server-side persistence, backed by SQLite (lib/db.ts, file DB_PATH, default ./data/app.db).
 * Each request loads, mutates and saves inside a transaction, so state stays consistent
 * across Next.js route bundles. Route handlers only use these functions.
 */

interface Secrets {
  qrSecret: string;
  organizerPin: string;
}

let warned = false;

/** Secrets come from .env; if missing, random values are generated once and kept in the database (meta table). */
export function secrets(): Secrets {
  let qrSecret = getMeta("qrSecret");
  let organizerPin = getMeta("organizerPin");
  if (!qrSecret) setMeta("qrSecret", (qrSecret = randomBytes(32).toString("hex")));
  if (!organizerPin) setMeta("organizerPin", (organizerPin = String(randomInt(100000, 1000000))));
  const fromEnvPin = process.env.ORGANIZER_PIN?.trim();
  const fromEnvSecret = process.env.QR_SECRET?.trim();
  if (!warned && (!fromEnvPin || !fromEnvSecret)) {
    warned = true;
    console.warn(`[soulmark] ORGANIZER_PIN/QR_SECRET not set in .env — using generated values stored in ${dbPath()}. Organizer PIN: ${fromEnvPin || organizerPin}`);
  }
  return { qrSecret: fromEnvSecret || qrSecret, organizerPin: fromEnvPin || organizerPin };
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
  const existing = readLedger();
  if (existing) return existing;
  // Empty database: seed the genesis block and a pre-created demo event so the demo works even on bad venue Wi-Fi.
  const now = new Date();
  const state = createLedger(now);
  createEvent(
    state,
    { name: "Vibeathon Round 1", date: now.toISOString().slice(0, 10), venue: "Graphic Era, Dehradun", description: "Demo event created on first start.", claimMinutes: 7 * 24 * 60 },
    issuer(),
    now,
  );
  writeLedger(state);
  return state;
}

export function saveLedger(state: LedgerState) {
  writeLedger(state);
}

/** Off-chain audit data for proxy detection: scans, claims with device/IP, blocked attempts. */
export function loadPresence(): PresenceState {
  return readPresence();
}

export function savePresence(state: PresenceState) {
  writePresence(state);
}

export function loadAuth(): AuthState {
  return readAuth();
}

export function saveAuth(state: AuthState) {
  writeAuth(state);
}
