# SoulMark — Round 1 summary

## What was built
A Next.js 16 + TypeScript PWA that issues **soulbound (non-transferable) attendance badges**:
- **Organizer:** PIN-protected dashboard → create event → presentation mode with a **rotating HMAC-signed QR** (20 s), countdown bar, live counter and claim animation → live claim feed with inline **revoke / reissue**.
- **Attendee:** scan QR → email + 6-digit key (demo mode shows the key) → wallet auto-created → **claim screen** with an animated holographic badge (art seeded from `sha256(eventId:wallet)`) → **badge wallet**.
- **Anyone:** `/verify/<wallet>` with a VERIFIED ON-CHAIN stamp, issuer, token # and block #; the `/api/check?wallet=&event=` API; and a `/explorer` page for the ledger.
- **Ledger:** append-only, hash-chained, with one transaction per block. It follows the ERC-5192 rules: `claim`, issuer-only `revoke` / `reissue`, `hasBadge`, `locked()` is always true, `transfer()` always reverts. `verifyChain()` replays the history and detects edits to blocks, transactions, ownership, revoked flags and event windows.
- **PWA:** manifest, plus a service worker that caches the wallet and verify data for bad venue Wi-Fi.

## Key decisions
| Decision | Why | Trade-off |
|---|---|---|
| Local hash-chained ledger instead of a live L2 | Fits the 35-minute build, and the same rules are fully unit-tested | Not trust-minimised: the server operator could rewrite the whole file. Round 2 moves to an ERC-5192 contract on Base Sepolia |
| QR → single-use voucher cookie | The QR dies in 30 s, but a first-time user needs time to sign in | A link forwarded within 30 s can still be claimed (no geofence yet) |
| Email + key with a server-created wallet | No seed phrase and no gas prompt, as the brief requires | Custodial; demo mode skips real email |
| JSON files + atomic writes | Zero dependencies, survives restarts | Single process; whole-file rewrite per request |
| Polling (1.5–3 s) instead of WebSockets | Simple and robust on venue Wi-Fi | Slightly delayed counter |
| CSS holographic badge instead of three.js | No heavy dependency, works on weak phones, respects reduced motion | Less "wow" than real 3D |

## Testing
- `npm test`: **22 unit tests**. They cover ledger rules, soulbound transfer revert, revoke / reissue (including double-reissue and re-claim after revoke), tamper detection, QR token / voucher forgery and expiry, OTP limits, sessions and input validation.
- `scripts/smoke.sh`: an API journey covering create event (and wrong PIN), QR, scan → voucher, sign-in, claim, duplicate and forged claims, wallet, public verify and check, dashboard, revoke, re-claim after revoke, and ledger validity.
- `scripts/ui-e2e.mjs`: the real-browser journey in headless Edge. Organizer → present QR → open QR link → email → key → claim (badge revealed) → wallet. It produced the screenshots in `docs/`.

## Independent review: what was found and fixed
An independent review (security, logic and frontend) checked every finding with an adversarial verifier. Nine findings were confirmed. Fixed:
1. **High: organizer PIN brute force.** After 10 wrong PINs, that client is locked out for 10 minutes, on every PIN-protected route.
2. **High: demo mode failed open.** The on-screen key now needs `DEMO_MODE=true` set explicitly, and the server logs a warning when it is on.
3. **High: a corrupt `ledger.json` was silently replaced.** A parse failure now refuses to overwrite the file, and writes are atomic (temp file + rename).
4. **High: a badge could be reissued twice.** The second reissue now returns 409.
5. **Medium: a revoked wallet could re-claim with the live QR.** That now returns 403 "revoked".
6. **Medium: `verifyChain` missed edits to revoked flags and event windows.** It now replays REVOKE and CREATE_EVENT transactions.
7. **Medium: re-requesting an OTP reset the wrong-key counter.** Attempts now carry over, and expired OTPs are pruned.
8. **Medium: the present page re-fetched the QR 4×/s after a failed refresh and kept showing a dead QR.** A failed refresh now clears the QR, and a closed event stops retrying.
9. **Low:**
   - The request size is checked before the body is read.
   - The claim page shows the server's real 400/403 message.
   - The verify page no longer crashes on malformed URL escapes.

Also found by our own UI test and fixed: the `/api/scan` redirect switched from `localhost` to the LAN IP, so the voucher cookie was set on the wrong host. It now redirects on the same host.

## Limitations (known, not yet addressed)
- **No public blockchain yet.** "Verified on-chain" refers to SoulMark's own hash-chained ledger. A server operator with file access could rebuild the whole chain.
- **Demo mode** shows the sign-in key on screen. Anyone can sign in as any email until real email delivery is added (`DEMO_MODE=false` logs the key on the server instead).
- **Presence proof is weak:** a QR link forwarded within ~30 s can be claimed remotely, and there is no geofence.
- **One shared organizer PIN.** The PIN lockout is per client IP; behind a proxy without `x-forwarded-for` all clients share one bucket, so someone could lock the organizer out for 10 minutes.
- `auth.json` grows with every distinct email (no per-IP rate limit on sign-in requests), and the JSON store rewrites whole files.
- The in-app camera scanner needs BarcodeDetector (Chrome/Edge on Android) and HTTPS or localhost; otherwise use the phone's camera app or paste the link.
- The 3D (React Three Fiber) badge, LinkedIn share card, tiers and the ZK proof from the brief are not built; they are in the backlog in `notes/plan.md`.

## Acceptance criteria status (from the plan)
All ten criteria (AC1–AC10) are met and checked by the unit tests, the API smoke test or the real-browser UI test. AC3 ("no seed phrase / no gas") is met in demo mode; real email delivery is a known limitation.
