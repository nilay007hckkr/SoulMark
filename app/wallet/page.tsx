"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Badge from "@/components/Badge";
import type { BadgeArt, EventRecord } from "@/lib/types";
import styles from "./wallet.module.css";

type BadgeView = {
  tokenId: number;
  eventId: string;
  owner: string;
  issuedAt: string;
  txHash: string;
  blockNumber: number;
  revoked: boolean;
  reissuedFrom?: number;
  art: BadgeArt;
  event: EventRecord;
};
type EventView = EventRecord & { claimed: number };
type Me = { wallet: string; handle: string; email: string };

function short(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

export default function WalletPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [badges, setBadges] = useState<BadgeView[] | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"badges" | "events">("badges");
  const [events, setEvents] = useState<EventView[] | null>(null);
  const [eventsErr, setEventsErr] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setError("");
    setBadges(null);
    try {
      const meRes = await fetch("/api/me", { cache: "no-store" });
      if (meRes.status === 401) {
        router.replace("/login?next=/wallet");
        return;
      }
      if (!meRes.ok) throw new Error(`Could not load your profile (${meRes.status})`);
      setMe(await meRes.json());
      const bRes = await fetch("/api/badges", { cache: "no-store" });
      if (bRes.status === 401) {
        router.replace("/login?next=/wallet");
        return;
      }
      const data = await bRes.json().catch(() => ({}));
      if (!bRes.ok) throw new Error(data.error || `Could not load badges (${bRes.status})`);
      setBadges(Array.isArray(data.badges) ? data.badges : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab !== "events" || events) return;
    setEventsErr("");
    fetch("/api/events", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Could not load events (${r.status})`);
        setEvents(Array.isArray(d.events) ? d.events : []);
      })
      .catch((e) => setEventsErr(e instanceof Error ? e.message : "Could not load events"));
  }, [tab, events]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    } catch {
      /* ignore */
    }
    router.replace("/");
  }

  async function copy(text: string, msg: string) {
    setToast((await copyText(text)) ? msg : "Could not copy");
  }

  const verifyUrl = me ? `${typeof window !== "undefined" ? window.location.origin : ""}/verify/${me.wallet}` : "";
  const total = badges?.length ?? 0;
  const revoked = badges?.filter((b) => b.revoked).length ?? 0;
  const active = total - revoked;

  return (
    <main className="screen screen--wide">
      <header className={styles.header}>
        <Link href={me ? `/verify/${me.wallet}` : "/"} className={styles.iconBtn} aria-label="Search / verify">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
        </Link>
        <div className="row">
          {me ? <span className="chip">{me.handle}</span> : <span className="skeleton" style={{ width: 90, height: 26 }} />}
          <span className="live">
            <span className={styles.liveDot} />
            LIVE
          </span>
          <div className="avatar" style={{ width: 36, height: 36, background: me ? `hsl(${parseInt(me.wallet.slice(2, 6), 16) % 360} 50% 40%)` : undefined }} />
        </div>
      </header>

      <nav className="tabs" style={{ marginTop: 16 }}>
        <Link href="/wallet" className="tab tab--active">MY</Link>
        <Link href={me ? `/verify/${me.wallet}` : "/wallet"} className="tab">VERIFY</Link>
        <Link href="/scan" className="tab">SCAN</Link>
      </nav>

      <div className={styles.hero}>
        <div className="bigtabs" role="tablist">
          <button role="tab" aria-selected={tab === "badges"} className={tab === "badges" ? "active" : ""} onClick={() => setTab("badges")}>
            Badges
          </button>
          <button role="tab" aria-selected={tab === "events"} className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>
            Events
          </button>
        </div>
        <div className={styles.stats}>
          <div className="stat"><b>{badges ? total : "–"}</b><span>BADGES</span></div>
          <div className="stat"><b style={{ color: "var(--live)" }}>{badges ? active : "–"}</b><span>ACTIVE</span></div>
          <div className="stat"><b style={{ color: revoked ? "var(--red)" : undefined }}>{badges ? revoked : "–"}</b><span>REVOKED</span></div>
        </div>
      </div>

      <section className={`card ${styles.profile}`}>
        <div className="label">Wallet Address</div>
        <div className={styles.addrRow}>
          {me ? <span className="mono-addr" title={me.wallet}>{short(me.wallet)}</span> : <span className="skeleton" style={{ width: 140, height: 22 }} />}
          <button className={styles.iconBtn} disabled={!me} onClick={() => me && copy(me.wallet, "Copied")} aria-label="Copy wallet address">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h8" />
            </svg>
          </button>
        </div>
        {me && <div className="label dim" style={{ fontSize: 16 }}>{me.email}</div>}
        <div className="row row--between">
          <button className="btn-ghost" disabled={!me} onClick={() => copy(verifyUrl, "Verify link copied")}>
            Share verify link
          </button>
          <button className="btn-danger" onClick={logout}>Logout</button>
        </div>
      </section>

      {tab === "badges" ? (
        <section style={{ marginTop: 20 }}>
          {error ? (
            <div className="stack" style={{ padding: "32px 0" }}>
              <div className="error" role="alert">{error}</div>
              <button className="btn-ghost" onClick={load} style={{ alignSelf: "flex-start" }}>Try again</button>
            </div>
          ) : badges === null ? (
            <div className={styles.gallery} aria-busy="true">
              {[0, 1, 2, 3].map((k) => (
                <div key={k} className={styles.badgeCard}>
                  <div className="skeleton" style={{ width: 160, height: 160, borderRadius: "50%" }} />
                  <div className="skeleton" style={{ width: 120, height: 16 }} />
                </div>
              ))}
            </div>
          ) : badges.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.cross} aria-hidden="true" />
              <p className="body-pixel" style={{ maxWidth: 320 }}>
                No badges yet — scan an event QR to claim your first one
              </p>
              <Link href="/scan" className="btn-primary" style={{ maxWidth: 320 }}>SCAN</Link>
            </div>
          ) : (
            <div className={styles.gallery}>
              {badges.map((b) => (
                <article key={b.tokenId} className={styles.badgeCard}>
                  <Badge art={b.art} eventName={b.event.name} date={b.event.date} size={160} revoked={b.revoked} />
                  <h3 className={styles.badgeName}>{b.event.name}</h3>
                  <div className={styles.meta}>{b.event.date} · {b.event.venue}</div>
                  <div className={styles.meta}>
                    TOKEN #{b.tokenId}
                    {b.revoked && <span style={{ color: "var(--red)" }}> · REVOKED</span>}
                  </div>
                  <button className={styles.share} onClick={() => copy(verifyUrl, "Verify link copied")}>
                    Share verify link
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section style={{ marginTop: 20 }}>
          {eventsErr ? (
            <div className="stack" style={{ padding: "32px 0" }}>
              <div className="error" role="alert">{eventsErr}</div>
              <button className="btn-ghost" onClick={() => setEvents(null)} style={{ alignSelf: "flex-start" }}>Try again</button>
            </div>
          ) : events === null ? (
            <div className="stack" aria-busy="true">
              {[0, 1, 2].map((k) => <div key={k} className="skeleton" style={{ height: 56 }} />)}
            </div>
          ) : events.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.cross} aria-hidden="true" />
              <p className="body-pixel">No events yet</p>
            </div>
          ) : (
            <div>
              <div className="label" style={{ marginBottom: 4 }}>Latest Events Created</div>
              {events.map((ev) => (
                <Link key={ev.id} href={`/explorer`} className={styles.eventRow}>
                  <div>
                    <div style={{ fontSize: 17 }}>{ev.name}</div>
                    <div className={styles.meta}>{ev.date} · {ev.venue}</div>
                  </div>
                  <div className="stat"><b>{ev.claimed}</b><span>CLAIMED</span></div>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
