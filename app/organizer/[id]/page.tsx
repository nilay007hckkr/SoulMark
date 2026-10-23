"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { EventRecord } from "@/lib/types";
import styles from "./event.module.css";

type EventView = EventRecord & { claimed: number };
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
