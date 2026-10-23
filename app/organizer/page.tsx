"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { EventRecord } from "@/lib/types";
import styles from "./organizer.module.css";

type EventView = EventRecord & { claimed: number };

const PIN_KEY = "sm_pin";

function readPin(): string | null {
  try {
    return sessionStorage.getItem(PIN_KEY);
  } catch {
    return null;
  }
}

function today(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function OrganizerPage() {
  const [pin, setPin] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPin(readPin());
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <main className="screen screen--center">
        <div className="skeleton" style={{ height: 120 }} />
      </main>
    );
  }

  if (!pin) {
    return (
      <PinGate
        onUnlock={(p) => {
          try {
            sessionStorage.setItem(PIN_KEY, p);
          } catch {}
          setPin(p);
        }}
      />
    );
  }

  return (
    <Dashboard
      pin={pin}
      onLock={() => {
        try {
          sessionStorage.removeItem(PIN_KEY);
        } catch {}
        setPin(null);
      }}
    />
  );
}

function PinGate({ onUnlock }: { onUnlock: (pin: string) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) {
      setError("Enter the organizer PIN");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/organizer/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: value.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || "Wrong PIN");
        return;
      }
      onUnlock(value.trim());
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <form onSubmit={submit} className="stack" style={{ flex: 1 }}>
        <p className="pixel label">SoulMark organizer</p>
        <div style={{ height: 48 }} />
        <label className="pixel label" htmlFor="pin">
          Enter organizer PIN
        </label>
        <input
          id="pin"
          className="input-line"
          type="password"
          autoComplete="current-password"
          inputMode="numeric"
          placeholder="••••"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        {error && <p className="error">{error}</p>}
        <div className="spacer" />
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}

function Dashboard({ pin, onLock }: { pin: string; onLock: () => void }) {
  const [events, setEvents] = useState<EventView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/events", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setEvents(Array.isArray(data.events) ? data.events : []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load events");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <main className="screen screen--wide">
      <header className="row row--between">
        <span className="pixel" style={{ fontSize: 22 }}>
          SoulMark organizer
        </span>
        <button className="btn-text" onClick={onLock}>
          Lock
        </button>
      </header>
      <hr className="divider" />

      <div className={styles.layout}>
        <CreateEvent pin={pin} onCreated={load} onUnauthorized={onLock} />

        <section className="stack">
          <h2 className="h-thin" style={{ fontSize: 40 }}>
            Your events
          </h2>
          {loadError && events === null && (
            <div className="card stack">
              <p className="error">Could not load events: {loadError}</p>
              <button className="btn-ghost" onClick={load}>
                Retry
              </button>
            </div>
          )}
          {loadError && events !== null && <p className="error">Live refresh failed — retrying…</p>}
          {events === null && !loadError && (
            <>
              <div className="skeleton" style={{ height: 120 }} />
              <div className="skeleton" style={{ height: 120 }} />
            </>
          )}
          {events !== null && events.length === 0 && (
            <div className="card">
              <p className="body-pixel">No events yet.</p>
              <p className="muted">Create your first event and present its QR so attendees can claim their badge.</p>
            </div>
          )}
          {events?.map((ev) => (
            <article key={ev.id} className={`card ${styles.eventCard}`}>
              <div className="row row--between" style={{ alignItems: "flex-start" }}>
                <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                  <strong className={styles.eventName}>{ev.name}</strong>
                  <span className="label">
                    {ev.date}
                    {ev.venue ? ` · ${ev.venue.toUpperCase()}` : ""}
                  </span>
                </div>
                <div className="stat">
                  <b className={styles.count}>{ev.claimed}</b>
                  <span>claimed</span>
                </div>
              </div>
              <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
                <Link className="btn-ghost" href={`/organizer/${ev.id}`}>
                  Open dashboard
                </Link>
                <Link className="btn-ghost" href={`/present/${ev.id}`}>
                  Present
                </Link>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}

function CreateEvent({
  pin,
  onCreated,
  onUnauthorized,
}: {
  pin: string;
  onCreated: () => void;
  onUnauthorized: () => void;
}) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(today());
  const [venue, setVenue] = useState("");
  const [description, setDescription] = useState("");
  const [claimMinutes, setClaimMinutes] = useState(120);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    if (!name.trim()) {
      setError("Event name is required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json", "x-organizer-pin": pin },
        body: JSON.stringify({ name: name.trim(), date, venue: venue.trim(), description: description.trim(), claimMinutes }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (!res.ok) {
        setError(data.error || `Could not create event (${res.status})`);
        return;
      }
      setCreated(data.event?.name ?? name.trim());
      setName("");
      setVenue("");
      setDescription("");
      onCreated();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <span className="pixel label">Create event</span>
      <label className="stack" style={{ gap: 6 }}>
        <span className="label">Name *</span>
        <input className="input-box" maxLength={80} required value={name} onChange={(e) => setName(e.target.value)} placeholder="Graphic Era Hack Night" />
      </label>
      <label className="stack" style={{ gap: 6 }}>
        <span className="label">Date</span>
        <input className="input-box" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="stack" style={{ gap: 6 }}>
        <span className="label">Venue</span>
        <input className="input-box" maxLength={120} value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Main auditorium" />
      </label>
      <label className="stack" style={{ gap: 6 }}>
        <span className="label">Description</span>
        <textarea className="input-box" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="stack" style={{ gap: 6 }}>
        <span className="label">Claim window</span>
        <select className="input-box" value={claimMinutes} onChange={(e) => setClaimMinutes(Number(e.target.value))}>
          <option value={30}>30 minutes</option>
          <option value={60}>1 hour</option>
          <option value={120}>2 hours</option>
          <option value={240}>4 hours</option>
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      {created && <p className="live">CREATED: {created.toUpperCase()}</p>}
      <button className="btn-primary" type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create event"}
      </button>
    </form>
  );
}
