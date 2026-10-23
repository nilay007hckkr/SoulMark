"use client";

import { stampLabel } from "@/lib/stamp";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Badge from "@/components/Badge";
import type { BadgeArt, EventRecord } from "@/lib/types";
import styles from "./verify.module.css";

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
type VerifyResult = { wallet: string; verified: boolean; badges: BadgeView[]; chainValid: boolean };
type State =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "error"; message: string }
  | { kind: "ok"; data: VerifyResult };

function fmt(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}
function short(s: string) {
  return s && s.length > 14 ? s.slice(0, 6) + "..." + s.slice(-4) : s;
}

export default function VerifyWalletPage() {
  const params = useParams<{ wallet: string }>();
  const rawWallet = String(params?.wallet ?? "");
  let wallet = rawWallet;
  try {
    wallet = decodeURIComponent(rawWallet);
  } catch {
    // malformed % escapes: keep the raw value; the API rejects it as an invalid address
  }
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetch("/api/verify/" + encodeURIComponent(wallet))
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 400) setState({ kind: "invalid" });
        else if (!res.ok) setState({ kind: "error", message: data?.error ?? "Could not load this wallet." });
        else setState({ kind: "ok", data: data as VerifyResult });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Network problem. Try again." });
      });
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  const exampleEvent =
    state.kind === "ok" && state.data.badges[0] ? state.data.badges[0].eventId : "<eventId>";

  return (
    <main className="screen screen--wide">
      <div className="row row--between">
        <Link href="/" className="label" style={{ textDecoration: "none" }}>SOULMARK</Link>
        <Link href="/verify" className="btn-text">CHECK ANOTHER</Link>
      </div>
      <p className="label" style={{ marginTop: 24 }}>PUBLIC VERIFICATION</p>
      <p className="mono-addr">{wallet}</p>

      <section className={styles.hero} aria-live="polite">
        {state.kind === "loading" && <div className={`skeleton ${styles.stampSkel}`} />}
        {state.kind === "invalid" && (
          <div className={`${styles.stamp} ${styles.stampRed}`}><span>INVALID<br />ADDRESS</span></div>
        )}
        {state.kind === "error" && <p className="error" role="alert">{state.message.toUpperCase()}</p>}
        {state.kind === "ok" && state.data.verified && (
          <>
            <div className={styles.stamp}><span>{stampLabel({ verified: true }).title}<br />SOULMARK LEDGER</span></div>
            <p className="label" style={{ textAlign: "center", marginTop: 12 }}>{stampLabel({ verified: true }).subtitle}</p>
          </>
        )}
        {state.kind === "ok" && !state.data.verified && (
          <div className={`${styles.stamp} ${styles.stampNeutral}`}><span>NO BADGES<br />FOUND</span></div>
        )}
      </section>

      {state.kind === "loading" && (
        <div className="stack">
          {[0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 120 }} />)}
        </div>
      )}

      {state.kind === "ok" && state.data.badges.length === 0 && (
        <p className="body-pixel muted center">THIS WALLET HAS NOT CLAIMED ANY SOULMARK BADGES YET.</p>
      )}

      {state.kind === "ok" && state.data.badges.length > 0 && (
        <div className="stack">
          <p className="label">
            {state.data.badges.length} BADGE{state.data.badges.length === 1 ? "" : "S"}
          </p>
          {state.data.badges.map((b) => (
            <article key={b.tokenId} className={`card ${styles.item} ${b.revoked ? styles.revoked : ""}`}>
              <div className={styles.badgeCol}>
                <Badge art={b.art} eventName={b.event.name} date={b.event.date} size={96} revoked={b.revoked} />
              </div>
              <div className={styles.meta}>
                <div className="row row--between" style={{ alignItems: "flex-start" }}>
                  <h2 className={styles.title}>{b.event.name}</h2>
                  <span className={b.revoked ? styles.statusRevoked : styles.statusActive}>
                    {b.revoked ? "REVOKED" : "ACTIVE"}
                  </span>
                </div>
                <dl className={styles.dl}>
                  <dt>DATE</dt><dd>{b.event.date}</dd>
                  <dt>VENUE</dt><dd>{b.event.venue}</dd>
                  <dt>ISSUER</dt>
                  <dd>{b.event.issuer} <span className="dim">{short(b.event.issuerAddress)}</span></dd>
                  <dt>ISSUED</dt><dd>{fmt(b.issuedAt)}</dd>
                  <dt>TOKEN</dt>
                  <dd>#{b.tokenId}{b.reissuedFrom != null ? ` (reissued from #${b.reissuedFrom})` : ""}</dd>
                  <dt>BLOCK</dt><dd>#{b.blockNumber}</dd>
                </dl>
                <Link href={"/explorer?tx=" + encodeURIComponent(b.txHash)} className="btn-text">
                  VIEW IN EXPLORER &rarr;
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="spacer" />
      <hr className="divider" />
      <footer className="stack">
        {state.kind === "ok" && (
          <p className="pixel" style={{ margin: 0 }}>
            LEDGER INTEGRITY:{" "}
            <span className={state.data.chainValid ? "live" : "error"}>
              {state.data.chainValid ? "VALID" : "BROKEN"}
            </span>
          </p>
        )}
        <p className="label" style={{ margin: 0, wordBreak: "break-all" }}>
          FOR APPS: GET /api/check?wallet={wallet || "…"}&amp;event={exampleEvent}
        </p>
      </footer>
    </main>
  );
}
