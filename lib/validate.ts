// Input validation shared by API routes (pure, no Next imports so it is unit-testable).

const EMAIL_RE = /^[^\s@<>()"',;:]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const EVENT_ID_RE = /^evt_[0-9a-f]{8}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

export function normalizeAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const addr = value.trim();
  return ADDRESS_RE.test(addr) ? addr.toLowerCase() : null;
}

export function isEventId(value: unknown): value is string {
  return typeof value === "string" && EVENT_ID_RE.test(value);
}

/** Trims, strips control characters and enforces a maximum length. Returns null if too long or not a string. */
export function cleanText(value: unknown, max: number, { required = false } = {}): string | null {
  if (value === undefined || value === null) return required ? null : "";
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (required && text.length === 0) return null;
  if (text.length > max) return null;
  return text;
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

export function isOtpCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

/** Only allow same-site relative redirects ("/wallet"), never "//evil.com" or "/\\evil.com". */
export function safeNext(value: unknown, fallback = "/wallet"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
