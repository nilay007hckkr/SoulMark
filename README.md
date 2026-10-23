# SoulMark — proof you were there

Non-transferable (soulbound) event badges. Attendees claim them by scanning a QR. Anyone can verify them from a link.

![SoulMark badge wallet with a claimed holographic badge](docs/screenshot.png)

| Big-screen rotating QR | Claim moment | Public verify page |
|---|---|---|
| ![Presentation mode with rotating QR and countdown bar](docs/present.png) | ![Claim screen with the holographic badge](docs/claim.png) | ![Verify page with the VERIFIED ON-CHAIN stamp](docs/verify.png) |

_All screenshots are captured from the running app by headless Edge (`scripts/ui-e2e.mjs`)._

## Problem
Certificates and attendance proofs are still PDFs, Google Forms and emails. They are easy to forge and easy to share with people who never came, and hard for a recruiter or university to check. Existing on-chain badges (e.g. POAP mint links) are bearer links that get shared and farmed.

## Solution
SoulMark is a mobile-first PWA backed by a soulbound-token ledger:
- **Organizers** create an event and put a **rotating, signed QR** on the big screen. It changes every 20 s, so screenshots stop working. A live counter shows the claims.
- **Attendees** scan, type their email and the 6-digit key, and a holographic badge lands in their wallet. There's no seed phrase, no gas and no app store.
- **Anyone** opens `/verify/<wallet>` and sees a **VERIFIED ON-CHAIN** stamp with event, issuer, date and the block it was recorded in. Apps can call `GET /api/check`.

## Features
| | |
|---|---|
| Soulbound ledger | Hash-chained, append-only ledger following ERC-5192 rules: `claim`, issuer-only `revoke` / `reissue`, `hasBadge`, `locked()` = true, `transfer()` always reverts. Tampering is detected by `verifyChain()` |
| Rotating signed QR | HMAC-SHA256 payload `{eventId, iat, exp, nonce}`, rotated every 20 s and valid 30 s. Opening a fresh QR swaps it for a **single-use claim voucher** (httpOnly cookie, 10 min), so new users have time to sign in |
| Email + key sign-in | 6-digit key (5 attempts, 5-min expiry, resend rate limit). An embedded wallet address is created automatically. Demo mode shows the key on screen |
| Claim screen | One button and an animated holographic badge (fly-in, spin, particle burst, haptic buzz). The art is seeded from `sha256(eventId:wallet)` |
| Badge wallet | All your badges, copyable wallet address, share-verify link. Cached by the service worker for bad venue Wi-Fi |
| Public verify page + API | No login. Shows the stamp, issuer, token # and block #, with a link to the ledger explorer. `GET /api/check?wallet=&event=` |
| Organizer dashboard | PIN-protected. Create events, live claim feed, inline revoke / reissue |
| Presentation mode | Full-screen rotating QR with a countdown bar, a live counter and claim animation |
| Ledger explorer | Every block and transaction, with an integrity check |
| Scanner | In-app camera scanner (BarcodeDetector), with a paste-link fallback |

## Tech stack
Next.js 16 (App Router) + TypeScript + React 19, plain CSS (design tokens from the templates), `qrcode` for QR SVGs. Tests use the built-in `node --test` runner (Node 24 runs TypeScript directly). Storage is JSON files in `data/` (git-ignored).

```
app/            pages (landing, login, claim, wallet, verify, organizer, present, explorer, scan) + api/ route handlers
components/     Badge (CSS holographic badge), service-worker registration
lib/            ledger.ts (soulbound rules + hash chain), qrToken.ts (rotating QR + vouchers),
                auth.ts (email key + sessions), validate.ts, store.ts (JSON persistence), http.ts
tests/          unit tests for ledger, QR tokens, auth and validation
scripts/        smoke.sh — end-to-end API smoke test
```

## Setup (Windows, PowerShell)
Requires Node.js 22.18+ (tested with 24.20).
```powershell
git clone https://github.com/nilay007hckkr/SoulMark.git
cd SoulMark
npm install
Copy-Item .env.example .env   # then set ORGANIZER_PIN and QR_SECRET
```
If `.env` is missing, a random PIN and secret are generated into `data/secrets.json`, and the PIN is printed in the server log.

## Run
```powershell
npm run build
npm start          # http://localhost:3000 and http://<LAN-IP>:3000
```
`run.cmd` installs, builds and starts in one go. Use `npm run dev` for hot reload. Phones on the same Wi-Fi can scan the QR straight away, because the QR encodes the LAN IP (override with `PUBLIC_BASE_URL`).

Demo: `/organizer` → PIN → create event → **PRESENT** → scan with a phone → email + key → badge → **Share verify link**.

## Test
```powershell
npm test                    # unit tests
npx tsc --noEmit -p .       # type check
```
```bash
ORGANIZER_PIN=<pin> bash scripts/smoke.sh http://localhost:3000   # end-to-end API smoke test (Git Bash)
```
```powershell
# Real-browser journey (present QR -> scan -> email -> key -> claim -> wallet) in headless Edge, saves screenshots
node scripts/ui-e2e.mjs "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" $env:TEMP http://localhost:3000 <pin>
```

## Honest limitations
- The ledger is a local, hash-chained log with the same rules as an ERC-5192 contract. It is **not yet deployed on a public chain**, so the server operator is trusted. The Round 2 plan is a Base Sepolia contract with EIP-712 vouchers and a paymaster.
- Demo mode shows the sign-in key on screen; no email is sent.
- A screenshot forwarded within ~30 s can still be claimed (no geofence yet).
- One organizer PIN and single-server JSON storage.

See [summary.md](summary.md) for decisions and the full list of limitations.
