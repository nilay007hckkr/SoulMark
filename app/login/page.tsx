"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";

type Step = "email" | "code" | "connecting";

function safeNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) return raw;
  return "/wallet";
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  // Already signed in? Skip ahead.
  useEffect(() => {
    let alive = true;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (alive && me && me.wallet) router.replace(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [next, router]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function requestCode() {
    setBusy(true);
    setError("");
    try {
      const data = await postJson("/api/auth/request", { email: email.trim() });
      setDemoCode(data.demoCode ?? null);
      setResendIn(typeof data.resendInSec === "number" ? data.resendInSec : 30);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your key");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter a valid email address");
      return;
    }
    if (await requestCode()) {
      setDigits(["", "", "", "", "", ""]);
      setStep("code");
      setTimeout(() => boxes.current[0]?.focus(), 50);
    }
  }

  async function verify(code: string) {
    setBusy(true);
    setError("");
    try {
      await postJson("/api/auth/verify", { email: email.trim(), code });
      setStep("connecting");
      setTimeout(() => router.replace(next), 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That key didn't work");
      setDigits(["", "", "", "", "", ""]);
      setTimeout(() => boxes.current[0]?.focus(), 50);
    } finally {
      setBusy(false);
    }
  }

  function setAt(idx: number, val: string) {
    let d = val.replace(/\D/g, "");
    if (d.length === 2 && digits[idx]) d = d.startsWith(digits[idx]) ? d[1] : d[0];
    if (d.length > 1) {
      fill(d, idx);
      return;
    }
    const copy = [...digits];
    copy[idx] = d;
    setDigits(copy);
    if (d && idx < 5) boxes.current[idx + 1]?.focus();
    if (copy.every((x) => x) && !busy) verify(copy.join(""));
  }

  function fill(d: string, from: number) {
    const copy = [...digits];
    for (let k = 0; k < d.length && from + k < 6; k++) copy[from + k] = d[k];
    setDigits(copy);
    const firstEmpty = copy.findIndex((x) => !x);
    boxes.current[firstEmpty === -1 ? 5 : firstEmpty]?.focus();
    if (copy.every((x) => x) && !busy) verify(copy.join(""));
  }

  function onKey(idx: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      const copy = [...digits];
      copy[idx - 1] = "";
      setDigits(copy);
      boxes.current[idx - 1]?.focus();
      e.preventDefault();
    } else if (e.key === "ArrowLeft" && idx > 0) boxes.current[idx - 1]?.focus();
    else if (e.key === "ArrowRight" && idx < 5) boxes.current[idx + 1]?.focus();
  }

  function onPaste(idx: number, e: ClipboardEvent<HTMLInputElement>) {
    const d = e.clipboardData.getData("text").replace(/\D/g, "");
    if (d) {
      e.preventDefault();
      fill(d, idx);
    }
  }

  if (step === "connecting") {
    return (
      <main className="screen screen--center">
        <div className="stack center" style={{ alignItems: "center" }}>
          <span className="spinner-slash" aria-hidden="true">/</span>
          <p className="body-pixel" style={{ fontSize: 24 }}>
            CONNECTING
            <br />
            YOUR WALLET
          </p>
        </div>
      </main>
    );
  }

  if (step === "code") {
    return (
      <main className="screen">
        <button className="btn-text" style={{ alignSelf: "flex-start" }} onClick={() => { setStep("email"); setError(""); }}>
          ← BACK
        </button>
        <div className="spacer" />
        <div className="stack" style={{ gap: 20 }}>
          <label className="label">Enter the key we&apos;ve emailed you</label>
          <div className="otp" role="group" aria-label="6 digit key">
            {digits.map((d, idx) => (
              <input
                key={idx}
                ref={(el) => {
                  boxes.current[idx] = el;
                }}
                inputMode="numeric"
                autoComplete={idx === 0 ? "one-time-code" : "off"}
                maxLength={6}
                value={d}
                aria-label={`Digit ${idx + 1}`}
                disabled={busy}
                onChange={(e) => setAt(idx, e.target.value)}
                onKeyDown={(e) => onKey(idx, e)}
                onPaste={(e) => onPaste(idx, e)}
              />
            ))}
          </div>
          {error && <div className="error" role="alert">{error}</div>}
          {demoCode && (
            <div className="label" style={{ color: "var(--orange)" }}>
              Demo mode — your key is {demoCode}
            </div>
          )}
          <div>
            {resendIn > 0 ? (
              <span className="label dim">Resend in {resendIn}s</span>
            ) : (
              <button className="btn-text" disabled={busy} onClick={requestCode} style={{ fontSize: 18 }}>
                Resend key
              </button>
            )}
          </div>
          <div className="label dim">Sent to {email}</div>
        </div>
        <div className="spacer" />
        <button
          className="btn-primary"
          disabled={busy || digits.some((x) => !x)}
          onClick={() => verify(digits.join(""))}
          style={{ position: "sticky", bottom: 0 }}
        >
          {busy ? "CHECKING…" : "CONFIRM"}
        </button>
      </main>
    );
  }

  return (
    <form className="screen" onSubmit={onEmail} style={{ paddingBottom: 0 }}>
      <div className="spacer" />
      <div className="stack" style={{ gap: 4 }}>
        <label className="label" htmlFor="email">
          Enter your email
        </label>
        <input
          id="email"
          className="input-line"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError("");
          }}
          autoFocus
        />
        {error && <div className="error" role="alert" style={{ marginTop: 8 }}>{error}</div>}
        <div className="label dim" style={{ marginTop: 48 }}>
          Got an invite code?
        </div>
      </div>
      <div className="spacer" />
      <div style={{ position: "sticky", bottom: 0, margin: "0 -20px", paddingTop: 12, background: "#000" }}>
        <button className="btn-primary" type="submit" disabled={busy || !email.trim()}>
          {busy ? "SENDING KEY…" : "JOIN / CONNECT"}
        </button>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="screen screen--center center"><span className="spinner-slash">/</span></main>}>
      <LoginInner />
    </Suspense>
  );
}
