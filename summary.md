# SoulMark — summary (Round 1 + Round 2)

## What was built
A Next.js 16 + TypeScript PWA that issues **soulbound (non-transferable) attendance badges**:
- **Organizer:**
  - PIN-protected dashboard → create event.
  - **Geofence** (room location + radius).
  - Presentation mode with a **rotating HMAC-signed QR** (20 s) and a live counter.
  - Live claim feed with **revoke / reissue**.
  - **Proxy Watch:** flagged claims, the person who shared a forwarded link, blocked proxy attempts, claim-time stats.
- **Attendee:** scan QR → email + 6-digit key → custodial wallet created → GPS check if the event is geofenced → **3D holographic badge** (three.js coin; art seeded from `sha256(eventId:wallet)`) → **badge wallet** with a featured 3D badge.
- **Anyone:**
  - `/verify/<wallet>` with an honest **VERIFIED · SOULMARK LEDGER** stamp and **Add to LinkedIn**.
  - The `/api/check` API (`onChain:false`, status, txHash).
  - An activity log of every block.
- **Ledger:** append-only and hash-chained, with ERC-5192 rules (`claim`, issuer-only `revoke`/`reissue`, `hasBadge`, `locked()`, `transfer()` reverts). `verifyChain()` replays history.
- **Contract (not deployed):** `contracts/SoulMark.sol`, ERC-5192 with EIP-712 issuer vouchers. 17 Hardhat tests.

## Round 2 — judges' comments
| # | Comment | Change | Files |
|---|---|---|---|
| 1 | Identify who shares the QR/link used for proxy | Each scan is recorded per phone (`sm_device`). The claim link carries the scan id, so a forwarded link is flagged high risk and the sharer is named on the dashboard | `lib/presence.ts`, `app/api/scan`, `app/api/claim`, `app/claim/page.tsx`, `app/api/events/[id]/integrity`, `app/organizer/[id]/page.tsx` |
| 2 | Geofence from the organizer dashboard with a radius | Geofence card: room location, radius 25–1000 m with presets, on/off. Server haversine check with accuracy allowance; no location fails closed | `lib/geo.ts`, `lib/ledger.ts` (`setGeofence`), `app/api/events/[id]/geofence`, `app/api/claim`, `app/claim/page.tsx`, `app/organizer/[id]/page.tsx` |
| 3 | Detect who's going to mark proxy | One phone claiming an event for a second account is blocked and the phone owner is identified. Risk score per claim; early warning for repeated scanners; median/p90 claim time | `lib/presence.ts`, `app/api/claim`, `app/api/events/[id]/integrity`, dashboard |
| 4 | 3D badges instead of 2D | three.js coin: thickness, iridescent art faces, orbiting lights, pointer/gyro tilt, claim fly-in. CSS fallback | `components/Badge3D.tsx`, `components/Badge3DLazy.tsx`, `app/claim/page.tsx`, `app/wallet/*` |

## Round 2 — brief/FIXES.md status
| ID | Fix | Status |
|---|---|---|
| F1 | ERC-5192 contract on Base Sepolia | **Partial:** contract + 17 tests + deploy script done. Not deployed: needs a funded testnet key (human setup) |
| F2 | Relayer + mint queue | **Skipped:** depends on a deployed contract and a funded relayer key |
| F3 | Honest stamp | **Done for the current state:** the stamp never says "on-chain" without a chain tx (tested); `/api/check` returns `onChain:false`; explorer renamed "Activity log". Reading `hasBadge` from the chain waits on F1/F2 |
| F4 | HTTPS, Secure cookies, proxy-aware IP | **Partial:** `TRUST_PROXY` (CF-Connecting-IP / proxy-added XFF entry), Secure cookies on HTTPS. The stable HTTPS tunnel is human setup |
| F5 | Continue with Google | **Skipped:** needs a Google OAuth client ID and an HTTPS origin |
| F6 | Real email delivery | **Done (config-gated):** nodemailer over SMTP when `SMTP_*` is set; unit-tested gating. Not tried against a live SMTP server |
| F7 | Geofence | **Done** (judge comment 2) |
| F8 | One claim per device per event + per-IP sign-in limit | **Done:** device cap (409, proxy marker recorded), per-IP OTP limit (default 20/10 min, configurable; classrooms share NAT), expired OTPs pruned |
| F9 | Claim-time metric | **Done:** median, p90, over-10 s on the dashboard |
| F10 | Gyroscope tilt / R3F | **Done** with plain three.js instead of R3F (judge comment 4) |
| F11 | Share card + Add to LinkedIn | **Partial:** "Add to LinkedIn" certification link done; OG share image not done |
| F12 | On-chain `tokenURI` art | **Skipped:** needs F1 deployed first |
| F13 | CI | **Done:** typecheck, tests, build, contract tests |
| F14 | Cross-platform scripts | **Partial:** `npm run setup`, `npm run e2e` (browser auto-detect), `npm run smoke` (still a bash script) |
| F15 | Repo cleanup | **Done:** MIT LICENSE, env keys in `.env.example`, FIXES.md at root. Kit zip **kept** (organizers require it); gitleaks not run |
| F16 | Trust model + threat table | **Done** in README |

## Round 2 independent review (fixed)
An adversarial review of the Round 2 code confirmed four issues, all fixed:
1. **High:** without a proxy in front, `next start` passes a client-supplied `X-Forwarded-For` through, so per-IP limits could be bypassed. Fix: global ceilings on wrong PINs (50 per 10 min) and sign-in requests. Verified live: after 50 wrong PINs from 50 forged IPs, even the right PIN is locked out.
2. The proxy-block 409 was shown as "You already have this badge". It now shows the real message.
3. `/api/scan` was unthrottled and could evict real scan records. Fix: one record per phone per QR window, plus per-IP and global rate limits.
4. A bad radius could stop the organizer switching the geofence off. Turning it off now always works.

Also: WebGL contexts are released on unmount.

Known and accepted: a recipient can launder a forwarded link by deleting `s=` (flagged "watch" instead of "high") or by re-opening the QR token within its ~30 s life. The geofence and network signals remain the defence there.

## Key decisions
| Decision | Why | Trade-off |
|---|---|---|
| Local hash-chained ledger; contract written but not deployed | No funded key and a 60-minute budget, and the judge comments came first | Not trustless yet. The stamp says so honestly |
| Block hard, flag soft (proxy) | Outside the geofence and a second account on one phone are near-certain proxies. Forwarded links and network mismatches have innocent explanations | A forwarded link still mints, but it is flagged and names the sharer; the organizer revokes |
| Personal claim link (`s=scanId`) + device cookie | Identifies the sharer without accounts at scan time | Cookie reset or incognito evades the device cap |
| Plain three.js instead of React Three Fiber | One dependency, no React 19 compatibility risk, lazy-loaded, one canvas per screen | Imperative code |
| Per-IP OTP limit 20/10 min, not 5 | A classroom shares one NAT IP | Weaker against a single-IP farm, which the device cap and the geofence cover |

## Testing
- `npm test`: **35 unit tests**. Covers ledger rules and tamper detection; QR/voucher; OTP, sessions and validation; and for Round 2 the geofence (inside, outside, accuracy cap, fail-closed), proxy detection (sharer naming, scan-window binding, second account on one phone, risk levels, early warning, claim-time stats), rate limit, the honest stamp and SMTP gating.
- `contracts`: **17 Hardhat tests**. Soulbound reverts, voucher expiry/forgery/replay, issuer-only actions, ERC-165 id, Locked event.
- `npm run smoke`: the API journey plus Round 2 scenarios.
  - Geofence: 428 without location, 403 from 1.1 km, OK inside.
  - A forwarded link is flagged and names the sharer.
  - A second account on the same phone is blocked.
  - The integrity report.
- `npm run e2e`: the real-browser journey in headless Edge. Checks the 3D canvas on the claim and wallet screens and the dashboard's geofence and proxy-watch sections.

## Limitations (current)
- **Not on a public blockchain yet.** The SoulMark ledger is tamper-evident but the operator could rebuild it. The contract needs a funded key and a relayer.
- **Presence checks are speed bumps:**
  - GPS can be spoofed.
  - Incognito or clearing cookies resets the device id.
  - A friend who claims within 30 s from inside the geofence radius is not caught.
- Demo mode shows the sign-in key on screen. Real email works only once `SMTP_*` is configured. Google sign-in is pending.
- Geolocation, the in-app scanner and the service worker need HTTPS on phones (tunnel + `PUBLIC_BASE_URL` + `TRUST_PROXY=true`).
- One organizer PIN; single-process JSON storage; per-IP limits are in memory (reset on restart).
- OG share image, R3F, ZK proofs, tiers and NFC are out of scope.
