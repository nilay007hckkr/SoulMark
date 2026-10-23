"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";
import type { BadgeArt } from "@/lib/types";
import Badge from "./Badge";
import badgeStyles from "./Badge.module.css";

export type Badge3DProps = {
  art: BadgeArt;
  eventName: string;
  date: string;
  size?: number;
  revoked?: boolean;
  animateIn?: boolean;
};

const FONT = '"VT323", ui-monospace, "Cascadia Mono", Consolas, monospace';
const TEX = 1024;

function wrap2(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > 2) {
    let second = lines.slice(1).join(" ");
    while (second.length > 1 && ctx.measureText(second + "...").width > maxW) second = second.slice(0, -1);
    return [lines[0], second + "..."];
  }
  return lines;
}

function drawFace(canvas: HTMLCanvasElement, art: BadgeArt, eventName: string, date: string, revoked: boolean) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const S = TEX;
  const c = S / 2;
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.clip();

  // base gradient at art.angle
  const a = (art.angle * Math.PI) / 180;
  const dx = Math.cos(a) * c;
  const dy = Math.sin(a) * c;
  const g = ctx.createLinearGradient(c - dx, c - dy, c + dx, c + dy);
  g.addColorStop(0, `hsl(${art.hueA},80%,55%)`);
  g.addColorStop(1, `hsl(${art.hueB},80%,50%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const rg = ctx.createRadialGradient(c * 0.7, c * 0.6, 0, c, c, c);
  rg.addColorStop(0, "rgba(255,255,255,0.25)");
  rg.addColorStop(1, "rgba(0,0,0,0.25)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, S, S);

  // pattern layer
  const n = Math.max(2, art.rings || 6);
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate((art.rotation * Math.PI) / 180);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 6;
  if (art.pattern === "grid") {
    const step = (S * 1.5) / (n * 2);
    for (let p = -S; p <= S; p += step) {
      ctx.beginPath();
      ctx.moveTo(p, -S);
      ctx.lineTo(p, S);
      ctx.moveTo(-S, p);
      ctx.lineTo(S, p);
      ctx.stroke();
    }
  } else if (art.pattern === "rays") {
    const wedges = n * 2;
    for (let i = 0; i < wedges; i += 2) {
      const a0 = (i / wedges) * Math.PI * 2;
      const a1 = ((i + 1) / wedges) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, S, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    for (let i = 1; i <= n; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, (c * i) / n, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();

  // inner disc + bevel rings
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.arc(c, c, c * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.lineWidth = 22;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.arc(c, c, c - 14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.arc(c, c, c - 30, 0, Math.PI * 2);
  ctx.stroke();

  // text
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(S * 0.085)}px ${FONT}`;
  const lines = wrap2(ctx, eventName, c * 1.15);
  const lh = S * 0.085;
  const top = c - lh * (lines.length === 2 ? 1.1 : 0.6);
  lines.forEach((l, i) => ctx.fillText(l, c, top + i * lh));
  ctx.font = `${Math.round(S * 0.06)}px ${FONT}`;
  ctx.globalAlpha = 0.85;
  ctx.fillText(date.toUpperCase(), c, c + S * 0.11);
  ctx.globalAlpha = 0.7;
  ctx.font = `${Math.round(S * 0.055)}px ${FONT}`;
  ctx.fillText(`#${art.code}`, c, c + S * 0.18);
  ctx.globalAlpha = 1;
  ctx.restore();

  if (revoked) {
    const img = ctx.getImageData(0, 0, S, S);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const y = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) * 0.7;
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    ctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate((-28 * Math.PI) / 180);
    ctx.font = `${Math.round(S * 0.12)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = ctx.measureText("REVOKED").width + 40;
    const h = S * 0.15;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = "#ff3b30";
    ctx.lineWidth = 8;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = "#ff3b30";
    ctx.fillText("REVOKED", 0, 4);
    ctx.restore();
  }
}

type IOSOrientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };

export default function Badge3D(props: Badge3DProps) {
  const { art, eventName, date, size = 240, revoked = false, animateIn = false } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const [burst, setBurst] = useState(false);
  const [needsPerm, setNeedsPerm] = useState(false);
  const orientRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const DOE = (typeof window !== "undefined" ? window.DeviceOrientationEvent : undefined) as IOSOrientation | undefined;
    if (DOE && typeof DOE.requestPermission === "function") setNeedsPerm(true);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size, size, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    camera.position.set(0, 0, 3.75);

    const faceCanvas = document.createElement("canvas");
    faceCanvas.width = faceCanvas.height = TEX;
    drawFace(faceCanvas, art, eventName, date, revoked);
    const tex = new THREE.CanvasTexture(faceCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    // Cylinder axis is Y; rotate so the top cap faces +Z (camera), then spin
    // 90deg about Z so the cap UVs map upright and un-mirrored on screen.
    const geo = new THREE.CylinderGeometry(1, 1, 0.14, 96);
    geo.rotateX(Math.PI / 2);
    geo.rotateZ(Math.PI / 2);

    const sat = revoked ? 0 : 70;
    const side = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(`hsl(${art.hueA}, ${sat}%, 60%)`),
      metalness: 1,
      roughness: 0.3,
    });
    const faceOpts: THREE.MeshPhysicalMaterialParameters = {
      map: tex,
      metalness: 0.35,
      roughness: 0.35,
      clearcoat: 1,
      iridescence: revoked ? 0 : 1,
    };
    const top = new THREE.MeshPhysicalMaterial(faceOpts);
    const bottom = new THREE.MeshPhysicalMaterial(faceOpts);
    const coin = new THREE.Mesh(geo, [side, top, bottom]);
    const pivot = new THREE.Group();
    pivot.add(coin);
    scene.add(pivot);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 3, 4);
    scene.add(key);
    const pA = new THREE.PointLight(new THREE.Color(`hsl(${art.hueA}, 90%, 60%)`), revoked ? 0 : 6, 10, 1.5);
    const pB = new THREE.PointLight(new THREE.Color(`hsl(${art.hueB}, 90%, 60%)`), revoked ? 0 : 6, 10, 1.5);
    scene.add(pA, pB);

    const pointer = { x: 0, y: 0 };
    const tilt = { x: 0, y: 0 };
    const MAX = (25 * Math.PI) / 180;
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
      pointer.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
    };
    const onLeave = () => {
      pointer.x = 0;
      pointer.y = 0;
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      orientRef.current = {
        x: Math.max(-1, Math.min(1, e.gamma / 35)),
        y: Math.max(-1, Math.min(1, (e.beta - 45) / 35)),
      };
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    window.addEventListener("deviceorientation", onOrient);

    const doFly = animateIn && !reduced;
    const FLY = 1200;
    let flyStart = -1;
    let flyDone = !doFly;
    if (!doFly && animateIn) {
      try {
        navigator.vibrate?.(60);
      } catch {
        /* ignore */
      }
    }

    const t0 = performance.now();
    const renderAt = (now: number) => {
      const t = (now - t0) / 1000;
      // orbiting coloured lights
      pA.position.set(Math.cos(t * 0.7) * 2.2, Math.sin(t * 0.9) * 1.6, 2);
      pB.position.set(Math.cos(t * 0.7 + Math.PI) * 2.2, Math.sin(t * 0.9 + Math.PI) * 1.6, 2);

      const src = orientRef.current && pointer.x === 0 && pointer.y === 0 ? orientRef.current : pointer;
      tilt.x += (src.y * MAX - tilt.x) * 0.08;
      tilt.y += (src.x * MAX - tilt.y) * 0.08;
      const idle = revoked ? 0 : 1;
      let spin = 0;
      let scale = 1;
      if (!flyDone) {
        if (flyStart < 0) flyStart = now;
        const p = Math.min(1, (now - flyStart) / FLY);
        const e = 1 - Math.pow(1 - p, 3);
        scale = 0.1 + 0.9 * e;
        spin = (1 - e) * Math.PI * 4;
        if (p >= 1) {
          flyDone = true;
          try {
            navigator.vibrate?.(60);
          } catch {
            /* ignore */
          }
          setBurst(true);
        }
      }
      pivot.scale.setScalar(scale);
      pivot.rotation.x = tilt.x + idle * Math.sin(t * 0.8) * 0.06;
      pivot.rotation.y = tilt.y + idle * Math.sin(t * 0.6) * 0.18 + spin;
      renderer.render(scene, camera);
    };

    let raf = 0;
    let visible = true;
    const loop = (now: number) => {
      renderAt(now);
      raf = visible ? requestAnimationFrame(loop) : 0;
    };
    const start = () => {
      if (!raf && !reduced) raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    let io: IntersectionObserver | null = null;
    if (reduced) {
      renderAt(t0);
    } else if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((entries) => {
        visible = entries.some((en) => en.isIntersecting);
        if (visible) start();
        else stop();
      });
      io.observe(canvas);
    } else {
      start();
    }

    // Redraw once the pixel webfont is ready.
    let alive = true;
    document.fonts?.ready
      .then(() => {
        if (!alive) return;
        drawFace(faceCanvas, art, eventName, date, revoked);
        tex.needsUpdate = true;
        if (reduced) renderAt(performance.now());
      })
      .catch(() => {});

    return () => {
      alive = false;
      stop();
      io?.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("deviceorientation", onOrient);
      geo.dispose();
      side.dispose();
      top.dispose();
      bottom.dispose();
      tex.dispose();
      renderer.dispose();
      renderer.forceContextLoss(); // release the WebGL context now; browsers cap live contexts
    };
  }, [art, eventName, date, size, revoked, animateIn]);

  async function askTilt() {
    const DOE = window.DeviceOrientationEvent as IOSOrientation | undefined;
    try {
      const res = await DOE?.requestPermission?.();
      if (res === "granted") setNeedsPerm(false);
    } catch {
      /* ignore */
    }
  }

  if (failed) return <Badge {...props} />;

  const particles = burst ? Array.from({ length: 14 }, (_, i) => i) : [];

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 8, flex: "none" }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <canvas
          ref={canvasRef}
          style={{ width: size, height: size, display: "block", touchAction: "pan-y" }}
          role="img"
          aria-label={`3D badge for ${eventName}, ${date}${revoked ? ", revoked" : ""}`}
        />
        {burst && (
          <div className={badgeStyles.burst} aria-hidden="true">
            {particles.map((i) => (
              <span
                key={i}
                style={
                  {
                    "--a": `${(360 / particles.length) * i}deg`,
                    "--d": `${size * 0.6 + (i % 3) * 18}px`,
                    background: i % 2 ? `hsl(${art.hueA} 90% 60%)` : `hsl(${art.hueB} 90% 60%)`,
                    animationDelay: "0s",
                  } as CSSProperties
                }
              />
            ))}
          </div>
        )}
      </div>
      {needsPerm && (
        <button type="button" className="btn-ghost" onClick={askTilt} style={{ width: "auto" }}>
          TILT WITH PHONE
        </button>
      )}
    </div>
  );
}
