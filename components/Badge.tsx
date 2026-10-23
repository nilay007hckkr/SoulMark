"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import type { BadgeArt } from "@/lib/types";
import styles from "./Badge.module.css";

type Props = {
  art: BadgeArt;
  eventName: string;
  date: string;
  size?: number;
  revoked?: boolean;
  animateIn?: boolean;
};

function patternCss(art: BadgeArt): string {
  const n = Math.max(2, art.rings || 6);
  if (art.pattern === "grid") {
    const s = Math.max(6, Math.round(120 / n));
    return `repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0 1px, transparent 1px ${s}px), repeating-linear-gradient(90deg, rgba(255,255,255,0.5) 0 1px, transparent 1px ${s}px)`;
  }
  if (art.pattern === "rays") {
    const deg = 360 / (n * 2);
    return `repeating-conic-gradient(rgba(255,255,255,0.55) 0deg ${deg / 2}deg, transparent ${deg / 2}deg ${deg}deg)`;
  }
  const step = Math.max(3, Math.round(70 / n));
  return `repeating-radial-gradient(circle, rgba(255,255,255,0.55) 0 2px, transparent 2px ${step}px)`;
}

export default function Badge({ art, eventName, date, size = 240, revoked = false, animateIn = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (animateIn) {
      try {
        navigator.vibrate?.(60);
      } catch {
        /* ignore */
      }
    }
  }, [animateIn]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const set = (x: number, y: number) => {
      el.style.setProperty("--ry", `${(x * 24).toFixed(1)}deg`);
      el.style.setProperty("--rx", `${(-y * 24).toFixed(1)}deg`);
    };
    const onMove = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      set((cx - r.left) / r.width - 0.5, (cy - r.top) / r.height - 0.5);
    };
    const mm = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const tm = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) onMove(t.clientX, t.clientY);
    };
    const reset = () => set(0, 0);
    const orient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      const gx = Math.max(-1, Math.min(1, e.gamma / 45));
      const by = Math.max(-1, Math.min(1, (e.beta - 45) / 45));
      set(gx * 0.5, by * 0.5);
    };
    el.addEventListener("mousemove", mm);
    el.addEventListener("mouseleave", reset);
    el.addEventListener("touchmove", tm, { passive: true });
    el.addEventListener("touchend", reset);
    window.addEventListener("deviceorientation", orient);
    return () => {
      el.removeEventListener("mousemove", mm);
      el.removeEventListener("mouseleave", reset);
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", reset);
      window.removeEventListener("deviceorientation", orient);
    };
  }, []);

  const a = `hsl(${art.hueA} 90% 55%)`;
  const b = `hsl(${art.hueB} 90% 55%)`;
  const base = `conic-gradient(from ${art.angle}deg, ${a}, ${b}, hsl(${(art.hueA + 60) % 360} 90% 60%), ${a})`;
  const over = `linear-gradient(${art.angle}deg, hsl(${art.hueA} 90% 55% / 0.8), transparent 50%, hsl(${art.hueB} 90% 55% / 0.8))`;
  const fs = Math.max(11, Math.round(size / 13));
  const particles = animateIn ? Array.from({ length: 14 }, (_, i) => i) : [];

  return (
    <div className={`${styles.wrap} ${animateIn ? styles.animateIn : ""}`} style={{ width: size, height: size }}>
      <div
        ref={ref}
        className={`${styles.badge} ${revoked ? styles.revoked : ""}`}
        style={{ width: size, height: size }}
        role="img"
        aria-label={`Badge for ${eventName}, ${date}${revoked ? ", revoked" : ""}`}
      >
        <div className={styles.layer} style={{ background: base }} />
        <div className={styles.layer} style={{ background: over }} />
        <div className={styles.layer}>
          <div className={styles.pattern} style={{ background: patternCss(art), transform: `rotate(${art.rotation}deg)` }} />
        </div>
        <div className={styles.layer}>
          <div className={styles.sheen} />
        </div>
        <div className={styles.inner}>
          <div className={styles.name} style={{ fontSize: fs * 1.2 }}>{eventName}</div>
          <div className={styles.date} style={{ fontSize: fs }}>{date}</div>
          <div className={styles.code} style={{ fontSize: fs * 0.9 }}>#{art.code}</div>
        </div>
      </div>
      {revoked && (
        <div className={styles.stamp} style={{ fontSize: Math.max(14, size / 8) }}>
          REVOKED
        </div>
      )}
      {animateIn && (
        <div className={styles.burst} aria-hidden="true">
          {particles.map((i) => (
            <span
              key={i}
              style={
                {
                  "--a": `${(360 / particles.length) * i}deg`,
                  "--d": `${size * 0.6 + (i % 3) * 18}px`,
                  background: i % 2 ? `hsl(${art.hueA} 90% 60%)` : `hsl(${art.hueB} 90% 60%)`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
