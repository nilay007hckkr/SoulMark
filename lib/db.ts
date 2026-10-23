import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import type { AuthState } from "./auth";
import type { BlockedRecord, ClaimRecord, PresenceState, ScanRecord } from "./presence";
import type { Badge, Block, EventRecord, LedgerState, Tx } from "./types";

/**
 * SQLite data-access module: the only place that talks to the database.
 * lib/store.ts calls these functions, so route handlers and the domain logic stay unchanged.
 * Path: DB_PATH env var, default ./data/app.db. Schema is created on first use (WAL, foreign keys on).
 */

type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS blocks (
  number INTEGER PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  prev_hash TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS txs (
  hash TEXT PRIMARY KEY,
  block_number INTEGER NOT NULL REFERENCES blocks(number) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL,
  from_address TEXT NOT NULL,
  data TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_txs_block ON txs(block_number, position);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  venue TEXT NOT NULL,
  description TEXT NOT NULL,
  issuer TEXT NOT NULL,
  issuer_address TEXT NOT NULL,
  claim_start TEXT NOT NULL,
  claim_end TEXT NOT NULL,
  geofence TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS badges (
  token_id INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  owner TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  tx_hash TEXT NOT NULL REFERENCES txs(hash),
  block_number INTEGER NOT NULL REFERENCES blocks(number),
  revoked INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  reissued_from INTEGER REFERENCES badges(token_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_badges_owner ON badges(owner);
CREATE INDEX IF NOT EXISTS idx_badges_event ON badges(event_id);
CREATE TABLE IF NOT EXISTS used_nonces (
  nonce_key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  wallet TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS otps (
  email TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  nonce TEXT NOT NULL,
  device_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_scans_nonce_device ON scans(nonce, device_id);
CREATE INDEX IF NOT EXISTS idx_scans_event_device ON scans(event_id, device_id);
CREATE TABLE IF NOT EXISTS claims (
  token_id INTEGER PRIMARY KEY REFERENCES badges(token_id),
  event_id TEXT NOT NULL REFERENCES events(id),
  wallet TEXT NOT NULL,
  device_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  at INTEGER NOT NULL,
  scan_id TEXT,
  scan_device_id TEXT,
  scan_at INTEGER,
  distance_m REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_claims_event_device ON claims(event_id, device_id);
CREATE TABLE IF NOT EXISTS blocked_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id),
  at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  wallet TEXT,
  device_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  device_owner_wallet TEXT,
  distance_m REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_id, at, device_id, reason)
);
CREATE INDEX IF NOT EXISTS idx_blocked_event ON blocked_attempts(event_id);
`;

const MAX_SCANS = 5_000;
const MAX_BLOCKED = 1_000;

export function dbPath(): string {
  return path.resolve(process.env.DB_PATH || path.join(process.cwd(), "data", "app.db"));
}

/** One connection per server process (kept on globalThis so every Next.js route bundle shares it). */
export function db(): DB {
  const g = globalThis as Record<string, unknown>;
  if (g.__smDb) return g.__smDb as DB;
  const file = dbPath();
  mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.pragma("busy_timeout = 5000");
  conn.exec(SCHEMA);
  g.__smDb = conn;
  importLegacyJson(conn, path.dirname(file));
  return conn;
}

// ---------- meta (secrets) ----------

export function getMeta(key: string): string | null {
  const row = db().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string) {
  db().prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

// ---------- ledger ----------

interface BlockRow { number: number; hash: string; prev_hash: string; timestamp: string }
interface TxRow { hash: string; block_number: number; type: Tx["type"]; from_address: string; data: string; timestamp: string }
interface EventRow { id: string; name: string; date: string; venue: string; description: string; issuer: string; issuer_address: string; claim_start: string; claim_end: string; geofence: string | null; created_at: string }
interface BadgeRow { token_id: number; event_id: string; owner: string; issued_at: string; tx_hash: string; block_number: number; revoked: number; revoked_at: string | null; reissued_from: number | null }

/** Returns null when the ledger has never been created (no genesis block yet). */
export function readLedger(): LedgerState | null {
  const conn = db();
  const blockRows = conn.prepare("SELECT number, hash, prev_hash, timestamp FROM blocks ORDER BY number").all() as BlockRow[];
  if (blockRows.length === 0) return null;
  const txRows = conn.prepare("SELECT hash, block_number, type, from_address, data, timestamp FROM txs ORDER BY block_number, position").all() as TxRow[];
  const txsByBlock = new Map<number, Tx[]>();
  for (const t of txRows) {
    const tx: Tx = { type: t.type, from: t.from_address, data: JSON.parse(t.data), timestamp: t.timestamp, hash: t.hash };
    const list = txsByBlock.get(t.block_number) ?? [];
    list.push(tx);
    txsByBlock.set(t.block_number, list);
  }
  const blocks: Block[] = blockRows.map((b) => ({ number: b.number, prevHash: b.prev_hash, timestamp: b.timestamp, txs: txsByBlock.get(b.number) ?? [], hash: b.hash }));
  const events: EventRecord[] = (conn.prepare("SELECT * FROM events ORDER BY rowid").all() as EventRow[]).map((e) => {
    const ev: EventRecord = { id: e.id, name: e.name, date: e.date, venue: e.venue, description: e.description, issuer: e.issuer, issuerAddress: e.issuer_address, claimStart: e.claim_start, claimEnd: e.claim_end, createdAt: e.created_at };
    if (e.geofence !== null) ev.geofence = JSON.parse(e.geofence);
    return ev;
  });
  const badges: Badge[] = (conn.prepare("SELECT * FROM badges ORDER BY token_id").all() as BadgeRow[]).map((b) => {
    const badge: Badge = { tokenId: b.token_id, eventId: b.event_id, owner: b.owner, issuedAt: b.issued_at, txHash: b.tx_hash, blockNumber: b.block_number, revoked: b.revoked === 1 };
    if (b.revoked_at !== null) badge.revokedAt = b.revoked_at;
    if (b.reissued_from !== null) badge.reissuedFrom = b.reissued_from;
    return badge;
  });
  const usedNonces: Record<string, number> = {};
  for (const n of conn.prepare("SELECT nonce_key, expires_at FROM used_nonces").all() as { nonce_key: string; expires_at: number }[]) usedNonces[n.nonce_key] = n.expires_at;
  return { blocks, events, badges, usedNonces };
}

export function writeLedger(state: LedgerState) {
  const conn = db();
  const insBlock = conn.prepare("INSERT OR IGNORE INTO blocks (number, hash, prev_hash, timestamp) VALUES (?, ?, ?, ?)");
  const insTx = conn.prepare("INSERT OR IGNORE INTO txs (hash, block_number, position, type, from_address, data, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const upEvent = conn.prepare(`INSERT INTO events (id, name, date, venue, description, issuer, issuer_address, claim_start, claim_end, geofence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, date = excluded.date, venue = excluded.venue, description = excluded.description,
      issuer = excluded.issuer, issuer_address = excluded.issuer_address, claim_start = excluded.claim_start, claim_end = excluded.claim_end, geofence = excluded.geofence`);
  const upBadge = conn.prepare(`INSERT INTO badges (token_id, event_id, owner, issued_at, tx_hash, block_number, revoked, revoked_at, reissued_from)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(token_id) DO UPDATE SET revoked = excluded.revoked, revoked_at = excluded.revoked_at, reissued_from = excluded.reissued_from`);
  const upNonce = conn.prepare("INSERT INTO used_nonces (nonce_key, expires_at) VALUES (?, ?) ON CONFLICT(nonce_key) DO UPDATE SET expires_at = excluded.expires_at");
  const pruneNonces = conn.prepare("DELETE FROM used_nonces WHERE nonce_key NOT IN (SELECT value FROM json_each(?))");
  conn.transaction(() => {
    for (const b of state.blocks) {
      insBlock.run(b.number, b.hash, b.prevHash, b.timestamp);
      b.txs.forEach((t, i) => insTx.run(t.hash, b.number, i, t.type, t.from, JSON.stringify(t.data), t.timestamp));
    }
    for (const e of state.events) {
      upEvent.run(e.id, e.name, e.date, e.venue, e.description, e.issuer, e.issuerAddress, e.claimStart, e.claimEnd, e.geofence ? JSON.stringify(e.geofence) : null, e.createdAt);
    }
    for (const b of state.badges) {
      upBadge.run(b.tokenId, b.eventId, b.owner, b.issuedAt, b.txHash, b.blockNumber, b.revoked ? 1 : 0, b.revokedAt ?? null, b.reissuedFrom ?? null);
    }
    for (const [key, exp] of Object.entries(state.usedNonces)) upNonce.run(key, exp);
    pruneNonces.run(JSON.stringify(Object.keys(state.usedNonces)));
  })();
}

// ---------- auth ----------

export function readAuth(): AuthState {
  const conn = db();
  const state: AuthState = { users: {}, otps: {}, sessions: {} };
  for (const u of conn.prepare("SELECT email, wallet, handle, created_at FROM users ORDER BY rowid").all() as { email: string; wallet: string; handle: string; created_at: string }[]) {
    state.users[u.email] = { email: u.email, wallet: u.wallet, handle: u.handle, createdAt: u.created_at };
  }
  for (const o of conn.prepare("SELECT email, hash, expires_at, attempts, sent_at FROM otps").all() as { email: string; hash: string; expires_at: number; attempts: number; sent_at: number }[]) {
    state.otps[o.email] = { hash: o.hash, exp: o.expires_at, attempts: o.attempts, sentAt: o.sent_at };
  }
  for (const s of conn.prepare("SELECT token_hash, email, expires_at FROM sessions").all() as { token_hash: string; email: string; expires_at: number }[]) {
    state.sessions[s.token_hash] = { email: s.email, exp: s.expires_at };
  }
  return state;
}

export function writeAuth(state: AuthState) {
  const conn = db();
  const upUser = conn.prepare("INSERT INTO users (email, wallet, handle, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET handle = excluded.handle");
  const upOtp = conn.prepare(`INSERT INTO otps (email, hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET hash = excluded.hash, expires_at = excluded.expires_at, attempts = excluded.attempts, sent_at = excluded.sent_at`);
  const upSession = conn.prepare("INSERT INTO sessions (token_hash, email, expires_at) VALUES (?, ?, ?) ON CONFLICT(token_hash) DO UPDATE SET expires_at = excluded.expires_at");
  const pruneOtps = conn.prepare("DELETE FROM otps WHERE email NOT IN (SELECT value FROM json_each(?))");
  const pruneSessions = conn.prepare("DELETE FROM sessions WHERE token_hash NOT IN (SELECT value FROM json_each(?))");
  conn.transaction(() => {
    for (const u of Object.values(state.users)) upUser.run(u.email, u.wallet, u.handle, u.createdAt);
    for (const [email, o] of Object.entries(state.otps)) upOtp.run(email, o.hash, o.exp, o.attempts, o.sentAt);
    for (const [hash, s] of Object.entries(state.sessions)) upSession.run(hash, s.email, s.exp);
    pruneOtps.run(JSON.stringify(Object.keys(state.otps)));
    pruneSessions.run(JSON.stringify(Object.keys(state.sessions)));
  })();
}

// ---------- presence (proxy-detection audit data) ----------

export function readPresence(): PresenceState {
  const conn = db();
  const scans = (conn.prepare("SELECT id, event_id, nonce, device_id, ip, at FROM scans ORDER BY rowid DESC LIMIT ?").all(MAX_SCANS) as { id: string; event_id: string; nonce: string; device_id: string; ip: string; at: number }[])
    .reverse()
    .map((s): ScanRecord => ({ id: s.id, eventId: s.event_id, nonce: s.nonce, deviceId: s.device_id, ip: s.ip, at: s.at }));
  const claims = (conn.prepare("SELECT * FROM claims ORDER BY rowid").all() as { token_id: number; event_id: string; wallet: string; device_id: string; ip: string; at: number; scan_id: string | null; scan_device_id: string | null; scan_at: number | null; distance_m: number | null }[])
    .map((c): ClaimRecord => ({ tokenId: c.token_id, eventId: c.event_id, wallet: c.wallet, deviceId: c.device_id, ip: c.ip, at: c.at, scanId: c.scan_id, scanDeviceId: c.scan_device_id, scanAt: c.scan_at, distanceM: c.distance_m }));
  const blocked = (conn.prepare("SELECT * FROM blocked_attempts ORDER BY id DESC LIMIT ?").all(MAX_BLOCKED) as { event_id: string; at: number; reason: string; wallet: string | null; device_id: string; ip: string; device_owner_wallet: string | null; distance_m: number | null }[])
    .reverse()
    .map((b): BlockedRecord => ({ eventId: b.event_id, at: b.at, reason: b.reason, wallet: b.wallet, deviceId: b.device_id, ip: b.ip, deviceOwnerWallet: b.device_owner_wallet, distanceM: b.distance_m }));
  return { scans, claims, blocked };
}

export function writePresence(state: PresenceState) {
  const conn = db();
  const insScan = conn.prepare("INSERT OR IGNORE INTO scans (id, event_id, nonce, device_id, ip, at) VALUES (?, ?, ?, ?, ?, ?)");
  const insClaim = conn.prepare(`INSERT OR IGNORE INTO claims (token_id, event_id, wallet, device_id, ip, at, scan_id, scan_device_id, scan_at, distance_m)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insBlocked = conn.prepare(`INSERT OR IGNORE INTO blocked_attempts (event_id, at, reason, wallet, device_id, ip, device_owner_wallet, distance_m)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  conn.transaction(() => {
    for (const s of state.scans) insScan.run(s.id, s.eventId, s.nonce, s.deviceId, s.ip, s.at);
    for (const c of state.claims) insClaim.run(c.tokenId, c.eventId, c.wallet, c.deviceId, c.ip, c.at, c.scanId, c.scanDeviceId, c.scanAt, c.distanceM);
    for (const b of state.blocked) insBlocked.run(b.eventId, b.at, b.reason, b.wallet, b.deviceId, b.ip, b.deviceOwnerWallet, b.distanceM);
  })();
}

// ---------- one-time import of the pre-SQLite JSON files ----------

/** If the DB is new and data/*.json from the JSON-file era exist, import them once and rename them to *.imported. */
function importLegacyJson(conn: DB, dir: string) {
  try {
    importLegacyJsonUnsafe(conn, dir);
  } catch (e) {
    console.error("[soulmark] could not import legacy JSON data into SQLite (left the JSON files in place)", e);
  }
}

const COUNT_SQL = {
  meta: "SELECT COUNT(*) AS n FROM meta",
  blocks: "SELECT COUNT(*) AS n FROM blocks",
  users: "SELECT COUNT(*) AS n FROM users",
  scans: "SELECT COUNT(*) AS n FROM scans",
  claims: "SELECT COUNT(*) AS n FROM claims",
} as const;

function importLegacyJsonUnsafe(conn: DB, dir: string) {
  const empty = (table: keyof typeof COUNT_SQL) => (conn.prepare(COUNT_SQL[table]).get() as { n: number }).n === 0;
  const take = <T>(name: string): T | null => {
    const file = path.join(dir, name);
    if (!existsSync(file)) return null;
    const value = JSON.parse(readFileSync(file, "utf8")) as T;
    return value;
  };
  const done = (name: string) => renameSync(path.join(dir, name), path.join(dir, `${name}.imported`));
  const secrets = empty("meta") ? take<{ qrSecret?: string; organizerPin?: string }>("secrets.json") : null;
  if (secrets) {
    if (secrets.qrSecret) setMeta("qrSecret", secrets.qrSecret);
    if (secrets.organizerPin) setMeta("organizerPin", secrets.organizerPin);
    done("secrets.json");
  }
  const ledger = empty("blocks") ? take<LedgerState>("ledger.json") : null;
  if (ledger?.blocks?.length) {
    writeLedger(ledger);
    done("ledger.json");
  }
  const auth = empty("users") ? take<AuthState>("auth.json") : null;
  if (auth?.users) {
    writeAuth(auth);
    done("auth.json");
  }
  const presence = empty("scans") && empty("claims") ? take<PresenceState>("presence.json") : null;
  if (presence?.scans) {
    writePresence(presence);
    done("presence.json");
  }
}
