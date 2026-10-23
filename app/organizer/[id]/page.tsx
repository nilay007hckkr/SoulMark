"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { EventRecord } from "@/lib/types";
import styles from "./event.module.css";

type Geofence = { enabled: boolean; lat: number; lng: number; radiusM: number };
type EventView = EventRecord & { claimed: number; geofence?: Geofence | null };
type Person = { wallet: string; handle: string; email: string };
type ClaimAudit = {
  tokenId: number;
  at: string;
  person: Person;
  risk: number;
  level: "ok" | "watch" | "high";
  reasons: string[];
  sharer: Person | null;
  distanceM: number | null;
  claimSec: number | null;
};
type BlockedAttempt = { at: string; reason: string; attemptedBy: Person | null; deviceOwner: Person | null; distanceM: number | null };
type Integrity = {
  stats: { claims: number; flagged: number; blocked: number; medianClaimSec: number | null; p90ClaimSec: number | null; over10s: number };
  claims: ClaimAudit[];
  blocked: BlockedAttempt[];
};
type Recent = { tokenId: number; owner: string; issuedAt: string; revoked: boolean };

const PIN_KEY = "sm_pin";

function shortAddr(a: string) {
  return a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function left(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m ${String(sec).padStart(2, "0")}s`;
}

export default function EventDashboardPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const router = useRouter();
  const [pin, setPin] = useState<string | null>(null);
  const [event, setEvent] = useState<EventView | null>(null);
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const seen = useRef<Set<number> | null>(null);
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [integrityError, setIntegrityError] = useState<string | null>(null);

  const unauthorized = useCallback(() => {
    try {
      sessionStorage.removeItem(PIN_KEY);
    } catch {}
    router.replace("/organizer");
  }, [router]);

  useEffect(() => {
    let p: string | null = null;
    try {
      p = sessionStorage.getItem(PIN_KEY);
    } catch {}
    if (!p) router.replace("/organizer");
    else setPin(p);
  }, [router]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      const rows: Recent[] = Array.isArray(data.recent) ? data.recent : [];
      if (seen.current) {
        const added = rows.filter((r) => !seen.current!.has(r.tokenId)).map((r) => r.tokenId);
        if (added.length) {
          setFresh((prev) => new Set([...prev, ...added]));
          setTimeout(() => {
            setFresh((prev) => {
              const n = new Set(prev);
              added.forEach((t) => n.delete(t));
              return n;
            });
          }, 2000);
        }
      }
      seen.current = new Set(rows.map((r) => r.tokenId));
      setEvent(data.event);
      setRecent(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load event");
    }
  }, [id]);

  const loadIntegrity = useCallback(async () => {
    if (!id || !pin) return;
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(id)}/integrity`, {
        cache: "no-store",
        headers: { "x-organizer-pin": pin },
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        unauthorized();
        return;
      }
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setIntegrity({
        stats: data.stats ?? { claims: 0, flagged: 0, blocked: 0, medianClaimSec: null, p90ClaimSec: null, over10s: 0 },
        claims: Array.isArray(data.claims) ? data.claims : [],
        blocked: Array.isArray(data.blocked) ? data.blocked : [],
      });
      setIntegrityError(null);
    } catch (err) {
      setIntegrityError(err instanceof Error ? err.message : "Could not load proxy watch");
    }
  }, [id, pin, unauthorized]);

  useEffect(() => {
    if (!pin) return;
    loadIntegrity();
    const t = setInterval(loadIntegrity, 3000);
    return () => clearInterval(t);
  }, [pin, loadIntegrity]);

  useEffect(() => {
    if (!pin) return;
    load();
    const t = setInterval(load, 2000);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [pin, load]);

  if (!pin) {
    return (
      <main className="screen screen--center">
        <div className="skeleton" style={{ height: 120 }} />
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="screen screen--center stack">
        <p className="h-pixel">Event not found</p>
        <Link className="btn-ghost" href="/organizer">
          Back to events
        </Link>
      </main>
    );
  }

  const revokedCount = recent?.filter((r) => r.revoked).length ?? 0;
  const startMs = event ? new Date(event.claimStart).getTime() : 0;
  const endMs = event ? new Date(event.claimEnd).getTime() : 0;
  const open = event ? now >= startMs && now < endMs : false;

  return (
    <main className="screen screen--wide">
      <header className="row row--between">
        <Link className="btn-text" href="/organizer">
          ← Events
        </Link>
        <Link className="btn-ghost" href={`/present/${id}`}>
          Present
        </Link>
      </header>

      {event ? (
        <div className="stack" style={{ margin: "16px 0" }}>
          <h1 className="h-thin">{event.name}</h1>
          <span className="label">
            {event.date}
            {event.venue ? ` · ${event.venue.toUpperCase()}` : ""}
          </span>
        </div>
      ) : (
        <div className="skeleton" style={{ height: 80, margin: "16px 0" }} />
      )}

      {error && !event && (
        <div className="card stack">
          <p className="error">Could not load event: {error}</p>
          <button className="btn-ghost" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {error && event && <p className="error">Live refresh failed — retrying…</p>}

      {event && (
        <div className={styles.stats}>
          <div className="card">
            <span className="label">Claimed</span>
            <div className={styles.big}>{event.claimed}</div>
          </div>
          <div className="card">
            <span className="label">Revoked</span>
            <div className={styles.big}>{revokedCount}</div>
          </div>
          <div className="card">
            <span className="label">Claim window</span>
            <div className={styles.mid} style={{ color: open ? "var(--live)" : "var(--red)" }}>
              {open ? "OPEN" : now < startMs ? "NOT YET" : "CLOSED"}
            </div>
            <span className="muted">{open ? `${left(endMs - now)} left` : now < startMs ? `opens in ${left(startMs - now)}` : "No new claims"}</span>
          </div>
          <div className="card">
            <span className="label">QR code</span>
            <div className={styles.mid}>20S</div>
            <span className="muted">Rotates every 20 seconds</span>
          </div>
        </div>
      )}

      {event && <GeofenceCard id={id} pin={pin} geofence={event.geofence ?? null} onSaved={load} onUnauthorized={unauthorized} />}

      <ProxyWatch data={integrity} error={integrityError} now={now} />

      <section className="stack" style={{ marginTop: 24 }}>
        <div className="row row--between">
          <span className="pixel label">Live claims</span>
          <span className="live">● LIVE</span>
        </div>
        {recent === null && !error && (
          <>
            <div className="skeleton" style={{ height: 64 }} />
            <div className="skeleton" style={{ height: 64 }} />
            <div className="skeleton" style={{ height: 64 }} />
          </>
        )}
        {recent !== null && recent.length === 0 && (
          <div className="card">
            <p className="body-pixel">No claims yet.</p>
            <p className="muted">Open presentation mode and ask attendees to scan the QR to claim their badge.</p>
          </div>
        )}
        {recent?.map((r) => (
          <ClaimRow key={r.tokenId} row={r} now={now} fresh={fresh.has(r.tokenId)} pin={pin} onChanged={load} onUnauthorized={unauthorized} />
        ))}
      </section>
    </main>
  );
}

function ClaimRow({
  row,
  now,
  fresh,
  pin,
  onChanged,
  onUnauthorized,
}: {
  row: Recent;
  now: number;
  fresh: boolean;
  pin: string;
  onChanged: () => void;
  onUnauthorized: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reissuing, setReissuing] = useState(false);
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  async function post(url: string, body?: unknown) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-organizer-pin": pin },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        onUnauthorized();
        return false;
      }
      if (!res.ok) {
        setMsg({ ok: false, text: data.error || `Failed (${res.status})` });
        return false;
      }
      onChanged();
      return true;
    } catch {
      setMsg({ ok: false, text: "Network error" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    if (await post(`/api/badges/${row.tokenId}/revoke`)) setMsg({ ok: true, text: "Badge revoked" });
  }

  async function reissue(e: React.FormEvent) {
    e.preventDefault();
    const w = wallet.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(w)) {
      setMsg({ ok: false, text: "Enter a valid 0x wallet address" });
      return;
    }
    if (await post(`/api/badges/${row.tokenId}/reissue`, { newWallet: w })) {
      setMsg({ ok: true, text: `Reissued to ${shortAddr(w)}` });
      setReissuing(false);
      setWallet("");
    }
  }

  return (
    <div className={`card ${styles.row} ${fresh ? styles.flash : ""}`}>
      <div className={styles.rowMain}>
        <span className="pixel" style={{ fontSize: 20 }}>#{row.tokenId}</span>
        <Link className="mono-addr" href={`/verify/${row.owner}`} title={row.owner}>
          {shortAddr(row.owner)}
        </Link>
        <span className="muted">{ago(row.issuedAt, now)}</span>
        {row.revoked ? <span className="error">REVOKED</span> : <span className="live">VALID</span>}
      </div>
      {!row.revoked && (
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <button className="btn-danger" onClick={revoke} disabled={busy}>
            {confirming ? "Are you sure? Revoke" : "Revoke"}
          </button>
          <button className="btn-ghost" onClick={() => setReissuing((v) => !v)} disabled={busy}>
            {reissuing ? "Cancel" : "Reissue"}
          </button>
        </div>
      )}
      {reissuing && !row.revoked && (
        <form className="row" onSubmit={reissue} style={{ marginTop: 10, flexWrap: "wrap" }}>
          <input className="input-box" style={{ flex: 1, minWidth: 200 }} placeholder="New wallet 0x…" value={wallet} onChange={(e) => setWallet(e.target.value)} />
          <button className="btn-ghost" type="submit" disabled={busy}>
            Send badge
          </button>
        </form>
      )}
      {msg && <p className={msg.ok ? "live" : "error"} style={{ margin: "8px 0 0" }}>{msg.text}</p>}
    </div>
  );
}

const RADIUS_PRESETS: { label: string; m: number }[] = [
  { label: "Classroom", m: 50 },
  { label: "Hall", m: 150 },
  { label: "Campus", m: 500 },
];

function fmtDist(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function GeofenceCard({
  id,
  pin,
  geofence,
  onSaved,
  onUnauthorized,
}: {
  id: string;
  pin: string;
  geofence: Geofence | null;
  onSaved: () => void;
  onUnauthorized: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [radius, setRadius] = useState(100);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = useRef(false);

  // Mirror the saved geofence until the organizer starts editing.
  useEffect(() => {
    if (dirty.current || !geofence) return;
    setEnabled(!!geofence.enabled);
    if (Number.isFinite(geofence.lat)) setLat(geofence.lat);
    if (Number.isFinite(geofence.lng)) setLng(geofence.lng);
    if (Number.isFinite(geofence.radiusM) && geofence.radiusM > 0) setRadius(geofence.radiusM);
  }, [geofence]);

  function touch() {
    dirty.current = true;
    setMsg(null);
  }

  function locate() {
    touch();
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setMsg({ ok: false, text: "Location is not available in this browser." });
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setMsg({ ok: false, text: "Location needs HTTPS (or localhost). Open the dashboard over a secure URL." });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(Number(pos.coords.latitude.toFixed(6)));
        setLng(Number(pos.coords.longitude.toFixed(6)));
        setAccuracy(pos.coords.accuracy);
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        const text =
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Allow location for this site and try again."
            : err.code === err.TIMEOUT
              ? "Timed out getting a GPS fix. Move near a window and retry."
              : "Location unavailable on this device (needs HTTPS or localhost).";
        setMsg({ ok: false, text });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }

  async function save() {
    if (enabled && (lat === null || lng === null)) {
      setMsg({ ok: false, text: "Set the room location before enabling the geofence." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const body: { enabled: boolean; lat?: number; lng?: number; radiusM?: number } = { enabled, radiusM: radius };
      if (lat !== null && lng !== null) {
        body.lat = lat;
        body.lng = lng;
      }
      const res = await fetch(`/api/events/${encodeURIComponent(id)}/geofence`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-organizer-pin": pin },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (!res.ok) {
        setMsg({ ok: false, text: data.error || `Failed (${res.status})` });
        return;
      }
      dirty.current = false;
      setMsg({ ok: true, text: enabled ? "Geofence saved" : "Geofence turned off" });
      onSaved();
    } catch {
      setMsg({ ok: false, text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  const on = !!geofence?.enabled;
  const hasPoint = lat !== null && lng !== null;
  const mapUrl = hasPoint ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}` : null;

  return (
    <section className={`card stack ${styles.section}`}>
      <div className="row row--between" style={{ flexWrap: "wrap", gap: 8 }}>
        <span className="pixel label">Geofence</span>
        <span className={styles.status} style={{ color: on ? "var(--live)" : "var(--muted)" }}>
          {on && geofence ? `ON · ${fmtDist(geofence.radiusM)} · ${geofence.lat.toFixed(5)},${geofence.lng.toFixed(5)}` : "OFF"}
        </span>
      </div>

      <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <button className="btn-ghost" onClick={locate} disabled={locating || busy}>
          {locating ? "Locating…" : "Use this room’s location"}
        </button>
        {hasPoint && (
          <span className="muted">
            {lat!.toFixed(5)}, {lng!.toFixed(5)}
            {accuracy !== null ? ` · ±${Math.round(accuracy)} m accuracy` : ""}
          </span>
        )}
        {mapUrl && (
          <a className="btn-text" href={mapUrl} target="_blank" rel="noopener noreferrer">
            Open map ↗
          </a>
        )}
      </div>
      {accuracy !== null && accuracy > radius && (
        <p className="muted" style={{ margin: 0, color: "var(--orange)" }}>
          GPS accuracy (±{Math.round(accuracy)} m) is wider than the radius — consider a larger radius.
        </p>
      )}

      <div className="stack" style={{ gap: 6 }}>
        <div className="row row--between">
          <span className="label">Radius</span>
          <span className={styles.status}>{fmtDist(radius)}</span>
        </div>
        <input
          className={styles.slider}
          type="range"
          min={25}
          max={1000}
          step={25}
          value={radius}
          aria-label="Geofence radius in metres"
          onChange={(e) => {
            touch();
            setRadius(Number(e.target.value));
          }}
        />
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {RADIUS_PRESETS.map((p) => (
            <button
              key={p.m}
              type="button"
              className={`btn-ghost ${styles.preset} ${radius === p.m ? styles.presetOn : ""}`}
              onClick={() => {
                touch();
                setRadius(p.m);
              }}
            >
              {p.label} {p.m}
            </button>
          ))}
        </div>
      </div>

      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            touch();
            setEnabled(e.target.checked);
          }}
        />
        <span className="label">Enabled</span>
      </label>

      <p className="label muted" style={{ margin: 0 }}>
        Attendees outside this radius cannot claim. GPS can be spoofed — this is a speed bump, not proof.
      </p>

      <button className="btn-primary" onClick={save} disabled={busy || locating}>
        {busy ? "Saving…" : "Save geofence"}
      </button>
      {msg && <p className={msg.ok ? "live" : "error"} style={{ margin: 0 }}>{msg.text}</p>}
    </section>
  );
}

function who(p: Person | null) {
  if (!p) return "unknown";
  const name = p.handle || shortAddr(p.wallet);
  return p.email ? `${name} (${p.email})` : name;
}

function secs(v: number | null) {
  return v === null || !Number.isFinite(v) ? "—" : `${v.toFixed(1)}s`;
}

function ProxyWatch({ data, error, now }: { data: Integrity | null; error: string | null; now: number }) {
  const flagged = data?.claims.filter((c) => c.level === "watch" || c.level === "high") ?? [];
  return (
    <section className={`stack ${styles.section}`}>
      <div className="row row--between">
        <span className="pixel label">Proxy watch</span>
        {data && <span className="muted">{data.stats.claims} claims audited</span>}
      </div>

      {data === null && !error && (
        <>
          <div className="skeleton" style={{ height: 90 }} />
          <div className="skeleton" style={{ height: 64 }} />
        </>
      )}
      {error && <p className="error" style={{ margin: 0 }}>Proxy watch unavailable: {error}</p>}

      {data && (
        <>
          <div className={styles.watchStats}>
            <div className="card">
              <span className="label">Flagged</span>
              <div className={styles.mid} style={{ color: data.stats.flagged ? "var(--orange)" : undefined }}>
                {data.stats.flagged}
              </div>
            </div>
            <div className="card">
              <span className="label">Blocked proxy</span>
              <div className={styles.mid} style={{ color: data.stats.blocked ? "var(--red)" : undefined }}>
                {data.stats.blocked}
              </div>
            </div>
            <div className="card">
              <span className="label">Median claim</span>
              <div className={styles.mid}>{secs(data.stats.medianClaimSec)}</div>
            </div>
            <div className="card">
              <span className="label">P90 claim</span>
              <div className={styles.mid}>{secs(data.stats.p90ClaimSec)}</div>
            </div>
            <div className="card">
              <span className="label">Over 10s</span>
              <div className={styles.mid}>{data.stats.over10s}</div>
            </div>
          </div>

          <span className="label">Flagged claims</span>
          {flagged.length === 0 && (
            <div className="card">
              <p className="body-pixel" style={{ margin: 0 }}>No suspicious claims yet</p>
            </div>
          )}
          {flagged.map((c) => (
            <div key={`${c.tokenId}-${c.at}`} className={`card ${styles.row}`}>
              <div className={styles.rowMain}>
                <span className={`${styles.risk} ${c.level === "high" ? styles.riskHigh : styles.riskWatch}`}>
                  {c.level.toUpperCase()} {Math.round(c.risk)}
                </span>
                <span className="pixel" style={{ fontSize: 20 }}>#{c.tokenId}</span>
                <span>{c.person?.handle || "—"}</span>
                {c.person?.wallet && (
                  <Link className="mono-addr" href={`/verify/${c.person.wallet}`} title={c.person.wallet}>
                    {shortAddr(c.person.wallet)}
                  </Link>
                )}
                {c.person?.email && <span className="muted">{c.person.email}</span>}
                <span className="muted">{ago(c.at, now)}</span>
              </div>
              {c.reasons?.length > 0 && (
                <div className={styles.chips}>
                  {c.reasons.map((r, i) => (
                    <span key={i} className={styles.reason}>
                      {r}
                    </span>
                  ))}
                </div>
              )}
              {(c.sharer || c.distanceM !== null || c.claimSec !== null) && (
                <div className={styles.rowMain}>
                  {c.sharer && (
                    <span className="error">
                      SHARED BY: {c.sharer.handle || shortAddr(c.sharer.wallet)} ({c.sharer.email || shortAddr(c.sharer.wallet)})
                    </span>
                  )}
                  {c.distanceM !== null && <span className="muted">{fmtDist(c.distanceM)} from room</span>}
                  {c.claimSec !== null && <span className="muted">claimed in {secs(c.claimSec)}</span>}
                </div>
              )}
            </div>
          ))}

          <span className="label">Blocked proxy attempts</span>
          {data.blocked.length === 0 && (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>No blocked attempts.</p>
            </div>
          )}
          {data.blocked.map((b, i) => (
            <div key={`${b.at}-${i}`} className={`card ${styles.row}`}>
              <div className={styles.rowMain}>
                <span className="error">BLOCKED</span>
                <span className="muted">{ago(b.at, now)}</span>
                <span className={styles.reason}>{b.reason}</span>
                {b.distanceM !== null && <span className="muted">{fmtDist(b.distanceM)} from room</span>}
              </div>
              <div className={styles.rowMain}>
                <span>tried by {who(b.attemptedBy)}</span>
                {b.deviceOwner && <span className="error">device belongs to {who(b.deviceOwner)}</span>}
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
