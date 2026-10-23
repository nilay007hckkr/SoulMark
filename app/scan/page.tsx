"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./scan.module.css";

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

type CamState = "starting" | "scanning" | "denied" | "nocamera" | "unsupported";

function extractToken(text: string): string | null {
  const s = text.trim();
  if (!s) return null;
  const m = s.match(/[?&]t=([^&#\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return null;
}

export default function ScanPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cam, setCam] = useState<CamState>("starting");
  const [paste, setPaste] = useState("");
  const [pasteErr, setPasteErr] = useState("");
  const done = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCam("nocamera");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      } catch (e) {
        const name = (e as DOMException)?.name;
        setCam(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "nocamera");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      if (!Ctor) {
        setCam("unsupported");
        return;
      }
      let detector: Detector;
      try {
        detector = new Ctor({ formats: ["qr_code"] });
      } catch {
        setCam("unsupported");
        return;
      }
      setCam("scanning");
      let busy = false;
      timer = setInterval(async () => {
        const v = videoRef.current;
        if (busy || done.current || !v || v.readyState < 2) return;
        busy = true;
        try {
          const codes = await detector.detect(v);
          for (const c of codes) {
            const raw = c.rawValue || "";
            const t = extractToken(raw);
            if (t && (raw.includes("/api/scan?t=") || raw.includes("/claim?t="))) {
              done.current = true;
              // Full navigation so the server can exchange the fresh QR for a claim voucher.
              window.location.assign("/api/scan?t=" + encodeURIComponent(t));
              return;
            }
          }
        } catch {
          // ignore single-frame failures
        } finally {
          busy = false;
        }
      }, 300);
    }

    start();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [router]);

  function go(e: React.FormEvent) {
    e.preventDefault();
    const t = extractToken(paste);
    if (!t) {
      setPasteErr("THAT LINK HAS NO CLAIM CODE (t=...)");
      return;
    }
    window.location.assign("/api/scan?t=" + encodeURIComponent(t));
  }

  const message: Record<CamState, string> = {
    starting: "STARTING CAMERA...",
    scanning: "POINT AT THE QR CODE ON SCREEN",
    denied: "CAMERA ACCESS WAS BLOCKED. ALLOW CAMERA IN YOUR BROWSER SETTINGS, OR PASTE THE LINK BELOW.",
    nocamera: "NO CAMERA AVAILABLE ON THIS DEVICE. PASTE THE LINK BELOW.",
    unsupported: "USE YOUR PHONE'S CAMERA APP TO SCAN THE QR, OR PASTE THE LINK BELOW",
  };
  const isError = cam === "denied" || cam === "nocamera" || cam === "unsupported";

  return (
    <main className={styles.wrap}>
      <video ref={videoRef} className={styles.video} playsInline muted aria-hidden />
      <div className={styles.overlay}>
        <div className="row row--between">
          <Link href="/" className="btn-text">&larr; BACK</Link>
          <span className="label">CLAIM YOUR BADGE</span>
        </div>

        <div className={styles.frame} aria-hidden>
          <span className={`${styles.c} ${styles.tl}`} />
          <span className={`${styles.c} ${styles.tr}`} />
          <span className={`${styles.c} ${styles.bl}`} />
          <span className={`${styles.c} ${styles.br}`} />
          {cam === "starting" && <span className="spinner-slash">/</span>}
        </div>

        <p className={isError ? "error center" : "body-pixel center"} role={isError ? "alert" : "status"}>
          {message[cam]}
        </p>

        <form onSubmit={go} className={styles.paste}>
          <label htmlFor="paste" className="label">OR PASTE THE CLAIM LINK</label>
          <div className="row">
            <input
              id="paste"
              className="input-box"
              placeholder="https://.../claim?t=..."
              value={paste}
              autoComplete="off"
              onChange={(e) => {
                setPaste(e.target.value);
                setPasteErr("");
              }}
            />
            <button type="submit" className={styles.go}>GO</button>
          </div>
          {pasteErr && <p className="error" style={{ margin: 0 }}>{pasteErr}</p>}
        </form>
      </div>
    </main>
  );
}
