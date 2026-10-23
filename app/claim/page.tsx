"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Badge from "@/components/Badge";
import type { BadgeArt, EventRecord } from "@/lib/types";
import styles from "./claim.module.css";

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

type Phase = "checking" | "ready" | "pending" | "done" | "error";
type Failure = { status: number; message: string; showWallet?: boolean };

function friendly(status: number, raw: string): Failure {
  const lower = raw.toLowerCase();
  if (status === 400) return { status, message: "This QR code has expired — scan the live one on screen again" };
  if (status === 409) {
    if (lower.includes("reuse") || lower.includes("used"))
      return { status, message: "This QR code was already used — scan the live one on screen again" };
    return { status, message: "You already have this badge", showWallet: true };
  }
  if (status === 403) return { status, message: "Claiming for this event is closed" };
  if (status === 404) return { status, message: "Event not found" };
  return { status, message: raw || "Something went wrong. Please try again." };
}

function ClaimInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("t") ?? "";
  const [phase, setPhase] = useState<Phase>("checking");
  const [badge, setBadge] = useState<BadgeView | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [toast, setToast] = useState("");
  const started = useRef(false);
  const key = "sm_claimed_" + token;

  const claim = useCallback(async () => {
    if (!token) return;
    setPhase("pending");
    setFailure(null);
    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.replace("/login?next=" + encodeURIComponent("/claim?t=" + token));
        return;
      }
      if (!res.ok) {
        setFailure(friendly(res.status, data?.error ?? ""));
        setPhase("error");
        return;
      }
      setBadge(data.badge);
      try { sessionStorage.setItem(key, JSON.stringify(data.badge)); } catch {}
      setPhase("done");
    } catch {
      setFailure({ status: 0, message: "Network problem. Check your connection and try again." });
      setPhase("error");
    }
  }, [token, key, router]);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    (async () => {
      try {
        const me = await fetch("/api/me");
        if (me.status === 401) {
          router.replace("/login?next=" + encodeURIComponent("/claim?t=" + token));
          return;
        }
      } catch {
        setFailure({ status: 0, message: "Network problem. Check your connection and try again." });
        setPhase("error");
        return;
      }
      let saved: BadgeView | null = null;
      try {
        const raw = sessionStorage.getItem(key);
        if (raw) saved = JSON.parse(raw);
      } catch {}
      if (saved) {
        setBadge(saved);
        setPhase("done");
        return;
      }
      setPhase("ready");
      void claim();
    })();
  }, [token, key, router, claim]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  async function share() {
    if (!badge) return;
    const url = window.location.origin + "/verify/" + badge.owner;
    try {
      await navigator.clipboard.writeText(url);
      setToast("Verify link copied");
    } catch {
      setToast(url);
    }
  }

  if (!token) {
    return (
      <main className="screen screen--center">
        <div className="stack">
          <p className="label">CLAIM YOUR BADGE</p>
          <h1 className="h-thin">No code found</h1>
          <p className="error">THIS LINK IS MISSING ITS CLAIM CODE.</p>
          <Link href="/scan" className="btn-primary">SCAN THE QR CODE</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="screen">
      <p className="label">SOULMARK</p>
      <h1 className="h-pixel" style={{ marginTop: 8 }}>CLAIM YOUR BADGE</h1>
      <div className="spacer" />

      {(phase === "checking" || phase === "pending" || phase === "ready") && (
        <div className={`stack center ${styles.pending}`} aria-live="polite">
          <span className="spinner-slash" aria-hidden>/</span>
          <h2 className="h-thin">Connecting your wallet</h2>
          <p className="body-pixel muted">{phase === "checking" ? "CHECKING YOUR SESSION..." : "ADDING YOUR BADGE TO THE LEDGER..."}</p>
          <div className={`skeleton ${styles.skel}`} />
        </div>
      )}

      {phase === "done" && badge && (
        <div className={`stack center ${styles.reveal}`}>
          <div className={styles.badgeWrap}>
            <Badge art={badge.art} eventName={badge.event.name} date={badge.event.date} size={280} animateIn />
          </div>
          <p className="live">BADGE CLAIMED</p>
          <h2 className={styles.eventName}>{badge.event.name}</h2>
          <p className="chip">BADGE #{badge.tokenId}</p>
          <p className="body-pixel muted">Yours forever — it can&apos;t be transferred</p>
        </div>
      )}

      {phase === "error" && failure && (
        <div className="stack center" role="alert">
          <p className="big-digit" aria-hidden>!</p>
          <p className="error">{failure.message.toUpperCase()}</p>
        </div>
      )}

      <div className="spacer" />

      {phase === "done" && badge && (
        <div className="stack">
          <Link href="/wallet" className="btn-primary">VIEW MY WALLET</Link>
          <button className="btn-ghost" onClick={share}>SHARE VERIFY LINK</button>
        </div>
      )}
      {phase === "error" && failure && (
        <div className="stack">
          {failure.showWallet ? (
            <Link href="/wallet" className="btn-primary">VIEW MY WALLET</Link>
          ) : failure.status === 400 || failure.status === 409 ? (
            <Link href="/scan" className="btn-primary">SCAN AGAIN</Link>
          ) : (
            <button className="btn-primary" onClick={claim}>CLAIM MY BADGE</button>
          )}
          <Link href="/" className="btn-text center">BACK HOME</Link>
        </div>
      )}
      {phase === "ready" && (
        <button className="btn-primary" onClick={claim}>CLAIM MY BADGE</button>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

export default function ClaimPage() {
  return (
    <Suspense fallback={<main className="screen"><div className="skeleton" style={{ height: 280 }} /></main>}>
      <ClaimInner />
    </Suspense>
  );
}
