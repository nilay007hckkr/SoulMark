"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function VerifyFormPage() {
  const router = useRouter();
  const [addr, setAddr] = useState("");
  const [err, setErr] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const a = addr.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
      setErr("ENTER A 0x ADDRESS (42 CHARACTERS)");
      return;
    }
    router.push("/verify/" + a);
  }

  return (
    <main className="screen">
      <Link href="/" className="label" style={{ textDecoration: "none" }}>SOULMARK</Link>
      <form onSubmit={submit} className="stack" style={{ flex: 1, marginTop: 40 }}>
        <p className="label">PUBLIC VERIFICATION</p>
        <h1 className="h-thin">Check a wallet</h1>
        <p className="body-pixel muted">SEE EVERY BADGE A WALLET HAS EARNED. NO LOGIN NEEDED.</p>
        <label htmlFor="addr" className="label" style={{ marginTop: 24 }}>WALLET ADDRESS</label>
        <input
          id="addr"
          className="input-line mono-addr"
          placeholder="0x..."
          autoComplete="off"
          spellCheck={false}
          value={addr}
          onChange={(e) => {
            setAddr(e.target.value);
            setErr("");
          }}
        />
        {err && <p className="error" role="alert">{err}</p>}
        <div className="spacer" />
        <button type="submit" className="btn-primary">VERIFY</button>
      </form>
    </main>
  );
}
