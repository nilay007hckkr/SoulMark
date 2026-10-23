"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./page.module.css";

const SLIDES = [
  { n: "1", title: "SCAN THE QR", body: "AT THE EVENT, SCAN THE LIVE QR ON THE ORGANIZER'S SCREEN. IT CHANGES EVERY 20 SECONDS, SO IT ONLY WORKS IF YOU'RE IN THE ROOM.", tone: "blue" },
  { n: "2", title: "CLAIM YOUR BADGE", body: "LOG IN WITH YOUR EMAIL AND CLAIM YOUR BADGE. IT LANDS IN YOUR WALLET, BOUND TO YOU FOREVER.", tone: "black" },
  { n: "3", title: "ANYONE CAN VERIFY", body: "SHARE ONE LINK. ANYONE CAN CHECK YOUR BADGES ARE REAL, ON-CHAIN, AND STILL VALID.", tone: "green" },
] as const;

const TOTAL = SLIDES.length + 1;

export default function Home() {
  const router = useRouter();
  const [splash, setSplash] = useState(true);
  const [i, setI] = useState(0);
  const [addr, setAddr] = useState("");
  const [addrErr, setAddrErr] = useState("");
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSplash(false), 1200);
    return () => clearTimeout(t);
  }, []);

  const next = () => setI((v) => Math.min(TOTAL - 1, v + 1));
  const prev = () => setI((v) => Math.max(0, v - 1));
  const last = i === TOTAL - 1;

  function onVerify(e: FormEvent) {
    e.preventDefault();
    const a = addr.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
      setAddrErr("ENTER A 0x WALLET ADDRESS (42 CHARACTERS)");
      return;
    }
    router.push(`/verify/${a}`);
  }

  if (splash) {
    return (
      <div className={styles.splash} onClick={() => setSplash(false)}>
        <div className={styles.logo}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="SoulMark" />
        </div>
      </div>
    );
  }

  const s = i > 0 ? SLIDES[i - 1] : null;

  return (
    <main className="screen">
      <div className={styles.top}>
        {!last && (
          <button className="btn-text" onClick={() => setI(TOTAL - 1)}>
            SKIP
          </button>
        )}
      </div>

      <div
        key={i}
        className={styles.slide}
        onClick={next}
        onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
        onTouchEnd={(e) => {
          const start = touchX.current;
          const end = e.changedTouches[0]?.clientX;
          touchX.current = null;
          if (start == null || end == null) return;
          const dx = end - start;
          if (dx < -40) next();
          else if (dx > 40) prev();
        }}
      >
        {i === 0 ? (
          <>
            <div className="gradbar" style={{ marginTop: 24 }}>
              <div className={`gradbar__marker ${styles.marker}`} />
            </div>
            <div className="spacer" />
            <h1 className="h-thin">HI THERE</h1>
            <p className="body-pixel">
              SOULMARK GIVES YOU BADGES THAT PROVE YOU WERE THERE. THEY LIVE ON-CHAIN AND CAN NEVER BE SOLD OR PASSED AROUND.
            </p>
          </>
        ) : (
          s && (
            <div className={`${styles.panel} ${styles[s.tone]}`}>
              <div className="big-digit">{s.n}</div>
              <div className="stack">
                <h2 className="h-pixel">{s.title}</h2>
                <p className="body-pixel" style={{ margin: 0 }}>{s.body}</p>
              </div>
            </div>
          )
        )}
      </div>

      <div className="dots" style={{ margin: "12px 0 20px" }}>
        {Array.from({ length: TOTAL }, (_, k) => (
          <button
            key={k}
            className={`dot ${k === i ? "dot--active" : ""}`}
            aria-label={`Slide ${k + 1}`}
            onClick={() => setI(k)}
          />
        ))}
      </div>

      {last ? (
        <Link href="/login" className="btn-primary">
          LOGIN
        </Link>
      ) : (
        <div className="row row--between">
          <span className="label">{i + 1}/{TOTAL}</span>
          <button className="btn-text" onClick={next}>
            NEXT
          </button>
        </div>
      )}

      <div className={styles.links}>
        <Link href="/organizer" className="btn-text">
          I&apos;m an organizer →
        </Link>
        <form className={styles.verifyForm} onSubmit={onVerify}>
          <input
            className="input-box"
            placeholder="Verify a wallet: 0x…"
            value={addr}
            onChange={(e) => {
              setAddr(e.target.value);
              setAddrErr("");
            }}
            aria-label="Wallet address to verify"
            spellCheck={false}
            autoCapitalize="off"
          />
          <button className="btn-ghost" type="submit">
            VERIFY
          </button>
        </form>
        {addrErr && <div className="error">{addrErr}</div>}
      </div>
    </main>
  );
}
