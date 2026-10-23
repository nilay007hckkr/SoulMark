"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Block } from "@/lib/types";
import styles from "./explorer.module.css";

type Chain = { height: number; valid: boolean; blocks: Block[] };

function short(h: string, n = 10) {
  return h && h.length > n + 4 ? h.slice(0, n) + "…" + h.slice(-4) : h;
}
function fmtTime(t: string | number) {
  const d = new Date(t);
  return isNaN(d.getTime()) ? String(t) : d.toLocaleString();
}
function dataText(d: unknown) {
  if (d == null) return "";
  if (typeof d === "string") return d;
  try {
    return JSON.stringify(d);
  } catch {
    return String(d);
  }
}

function ExplorerInner() {
  const params = useSearchParams();
  const txParam = params.get("tx") ?? "";
  const [chain, setChain] = useState<Chain | null>(null);
  const [error, setError] = useState("");
  const scrolled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/chain", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(data?.error ?? "Could not load the ledger.");
          return;
        }
        setChain(data as Chain);
        setError("");
      } catch {
        if (!cancelled) setError("Network problem. Retrying…");
      }
    }
    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const foundBlock =
    txParam && chain ? chain.blocks.find((b) => b.txs.some((t) => t.hash === txParam)) : undefined;

  useEffect(() => {
    if (!foundBlock || scrolled.current) return;
    scrolled.current = true;
    document.getElementById("tx-" + txParam)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [foundBlock, txParam]);

  return (
    <main className="screen screen--wide">
      <div className="row row--between">
        <Link href="/" className="label" style={{ textDecoration: "none" }}>SOULMARK</Link>
        <span className="live">● LIVE</span>
      </div>
      <h1 className="h-pixel" style={{ marginTop: 16 }}>SOULMARK ACTIVITY LOG</h1>
      {chain && (
        <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
          <span className="chip">HEIGHT {chain.height}</span>
          <span className={chain.valid ? styles.valid : styles.broken}>{chain.valid ? "VALID" : "BROKEN"}</span>
        </div>
      )}

      {txParam && chain && (
        <p className={foundBlock ? styles.bannerOk : styles.bannerBad} role="status">
          {foundBlock
            ? `TRANSACTION FOUND IN BLOCK #${foundBlock.number}`
            : `TRANSACTION ${short(txParam)} NOT FOUND`}
        </p>
      )}

      {error && <p className="error" role="alert" style={{ marginTop: 16 }}>{error.toUpperCase()}</p>}

      {!chain && !error && (
        <div className="stack" style={{ marginTop: 24 }}>
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 110 }} />)}
        </div>
      )}

      {chain && chain.blocks.length === 0 && (
        <p className="body-pixel muted center" style={{ marginTop: 40 }}>NO BLOCKS YET.</p>
      )}

      {chain && chain.blocks.length > 0 && (
        <div className="stack" style={{ marginTop: 24 }}>
          {chain.blocks.map((b) => (
            <article key={b.number} className={`card ${styles.block}`}>
              <div className="row row--between" style={{ flexWrap: "wrap" }}>
                <span className="h-pixel" style={{ fontSize: 26 }}>#{b.number}</span>
                <span className="label" style={{ fontSize: 16 }}>{fmtTime(b.timestamp)}</span>
              </div>
              <p className={styles.hash}><span className="label">HASH</span> {short(b.hash, 16)}</p>
              <p className={styles.hash}><span className="label">PREV</span> {short(b.prevHash, 16)}</p>
              {b.txs.length === 0 ? (
                <p className="label">NO TRANSACTIONS</p>
              ) : (
                <ul className={styles.txs}>
                  {b.txs.map((t) => (
                    <li
                      key={t.hash}
                      id={"tx-" + t.hash}
                      className={`${styles.tx} ${t.hash === txParam ? styles.txHit : ""}`}
                    >
                      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                        <span className={`${styles.type} ${styles["t_" + t.type] ?? ""}`}>{t.type}</span>
                        <span className={styles.hash}>{short(t.hash, 12)}</span>
                      </div>
                      <p className={styles.from}>FROM {short(t.from, 8)}</p>
                      <pre className={styles.data}>{dataText(t.data)}</pre>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

export default function ExplorerPage() {
  return (
    <Suspense fallback={<main className="screen screen--wide"><div className="skeleton" style={{ height: 200 }} /></main>}>
      <ExplorerInner />
    </Suspense>
  );
}
