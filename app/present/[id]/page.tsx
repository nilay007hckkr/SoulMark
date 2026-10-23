"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { EventRecord } from "@/lib/types";
import styles from "./present.module.css";

type EventView = EventRecord & { claimed: number };
type Recent = { tokenId: number; owner: string; issuedAt: string; revoked: boolean };
type Qr = { claimUrl: string; svg: string; expiresAt: number; rotateMs: number; serverNow: number };
type Flight = { key: number; x0: number; y0: number; x1: number; y1: number };

const PIN_KEY = "sm_pin";

function shortAddr(a: string) {
  return a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export default function PresentPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const router = useRouter();
  const [pin, setPin] = useState<string | null>(null);
  const [qr, setQr] = useState<Qr | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [event, setEvent] = useState<EventView | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [evError, setEvError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pop, setPop] = useState(0);
  const [flights, setFlights] = useState<Flight[]>([]);
  const offset = useRef(0);
  const fetching = useRef(false);
  const lastCount = useRef<number | null>(null);
  const qrRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLDivElement>(null);

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

  const loadQr = useCallback(async () => {
    if (!pin || !id || fetching.current) return;
    fetching.current = true;
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(id)}/qr`, {
        cache: "no-store",
        headers: { "x-organizer-pin": pin },
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        unauthorized();
        return;
      }
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      offset.current = Number(data.serverNow) - Date.now();
      setQr(data as Qr);
      setQrError(null);
    } catch (err) {
      setQrError(err instanceof Error ? err.message : "Could not load QR");
    } finally {
      fetching.current = false;
    }
  }, [pin, id, unauthorized]);

  const launch = useCallback(() => {
    const a = qrRef.current?.getBoundingClientRect();
    const b = counterRef.current?.getBoundingClientRect();
    if (!a || !b) return;
    const f: Flight = {
      key: Date.now() + Math.random(),
      x0: a.left + a.width / 2,
      y0: a.top + a.height / 2,
      x1: b.left + b.width / 2,
      y1: b.top + b.height / 2,
    };
    setFlights((prev) => [...prev.slice(-4), f]);
    setTimeout(() => setFlights((prev) => prev.filter((x) => x.key !== f.key)), 1000);
  }, []);

  const loadEvent = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      const ev: EventView = data.event;
      if (lastCount.current !== null && ev.claimed > lastCount.current) {
        launch();
        setTimeout(() => setPop((p) => p + 1), 700);
      }
      lastCount.current = ev.claimed;
      setEvent(ev);
      setRecent(Array.isArray(data.recent) ? data.recent.slice(0, 5) : []);
      setEvError(null);
    } catch (err) {
      setEvError(err instanceof Error ? err.message : "Could not load event");
    }
  }, [id, launch]);

  useEffect(() => {
    if (!pin) return;
    loadQr();
    loadEvent();
    const e = setInterval(loadEvent, 1500);
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearInterval(e);
      clearInterval(t);
    };
  }, [pin, loadQr, loadEvent]);

  // Refetch when the current code expires (also covers the rotateMs cadence).
  const serverNow = now + offset.current;
  const rotateMs = qr?.rotateMs || 20000;
  const remaining = qr ? qr.expiresAt - serverNow : rotateMs;
  useEffect(() => {
    if (qr && remaining <= 0) loadQr();
  }, [qr, remaining, loadQr]);
  useEffect(() => {
    if (!pin) return;
    const r = setInterval(loadQr, rotateMs);
    return () => clearInterval(r);
  }, [pin, rotateMs, loadQr]);
  // Retry QR after an error.
  useEffect(() => {
    if (!qrError) return;
    const r = setTimeout(loadQr, 3000);
    return () => clearTimeout(r);
  }, [qrError, loadQr]);

  const progress = Math.min(1, Math.max(0, 1 - remaining / rotateMs));
  const secsLeft = Math.max(0, Math.ceil(remaining / 1000));

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  if (!pin) {
    return (
      <main className="screen screen--center">
        <div className="skeleton" style={{ height: 200 }} />
      </main>
    );
  }

  return (
    <main className={`screen screen--wide ${styles.page}`}>
      <header className="row row--between">
        <Link className="btn-text" href={`/organizer/${id}`}>
          ← Dashboard
        </Link>
        <span className="live">● LIVE</span>
        <button className="btn-ghost" onClick={toggleFullscreen}>
          Fullscreen
        </button>
      </header>

      <div className={styles.cols}>
        <section className={styles.left}>
          <div ref={qrRef} className={styles.qrBox}>
            {qr ? (
              <div className={styles.qrSvg} dangerouslySetInnerHTML={{ __html: qr.svg }} aria-label="Claim QR code" role="img" />
            ) : qrError ? (
              <p className="error" style={{ padding: 16, textAlign: "center" }}>{qrError}</p>
            ) : (
              <div className="skeleton" style={{ width: "80%", height: "80%" }} />
            )}
          </div>
          <div className={`gradbar ${styles.bar}`}>
            <div className="gradbar__marker" style={{ left: `${progress * 100}%` }} />
          </div>
          <p className="body-pixel center">CODE REFRESHES IN {secsLeft}S — SCREENSHOTS WON&apos;T WORK</p>
          {qrError && qr && <p className="error center">QR refresh failed — retrying…</p>}
          {qr && (
            <p className={`muted center ${styles.url}`}>
              No camera? Open <a href={qr.claimUrl}>{qr.claimUrl}</a>
            </p>
          )}
        </section>

        <section className={styles.right}>
          {event ? (
            <>
              <h1 className="h-thin">{event.name}</h1>
              <p className="label">
                {event.date}
                {event.venue ? ` · ${event.venue.toUpperCase()}` : ""}
              </p>
            </>
          ) : evError ? (
            <p className="error">Could not load event: {evError}</p>
          ) : (
            <div className="skeleton" style={{ height: 100 }} />
          )}

          <span className="pixel label" style={{ marginTop: 24 }}>Badges claimed</span>
          <div ref={counterRef} key={pop} className={`${styles.counter} ${pop ? styles.pop : ""}`}>
            {event ? event.claimed : "—"}
          </div>

          <span className="pixel label">Latest claims</span>
          {recent.length === 0 ? (
            <p className="body-pixel muted">Waiting for the first scan…</p>
          ) : (
            <ul className={styles.ticker}>
              {recent.map((r) => (
                <li key={r.tokenId} className="mono-addr">
                  <span className="dim">#{r.tokenId}</span> {shortAddr(r.owner)}
                  {r.revoked && <span className="error"> REVOKED</span>}
                </li>
              ))}
            </ul>
          )}
          {evError && event && <p className="error">Live count paused — retrying…</p>}
        </section>
      </div>

      {flights.map((f) => (
        <span
          key={f.key}
          className={styles.flight}
          style={
            {
              "--x0": `${f.x0}px`,
              "--y0": `${f.y0}px`,
              "--x1": `${f.x1}px`,
              "--y1": `${f.y1}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </main>
  );
}
