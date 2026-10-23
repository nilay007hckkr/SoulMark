# SoulMark — explaining it to the judges

## English (about 2 minutes)

**Problem and target user.** Certificates and attendance proofs are PDFs and Google Forms. They are easy to fake, easy to "mark proxy" for friends who never came, and slow to verify. Our users are event organizers (college classes, clubs, hackathons), the attendees who want proof that is truly theirs, and recruiters or universities who need to check it in seconds.

**Solution.** SoulMark gives every attendee a soulbound badge, a token that can never be transferred or sold. The organizer shows a QR code that changes every 20 seconds and can lock claiming to the room with a geofence. The attendee scans, enters their email and a 6-digit key, and a 3D badge lands in their wallet. If someone tries to mark proxy, the organizer's Proxy Watch shows who shared the link and blocks a phone that claims for a second person.

**How it works.** Five parts:
1. **Rotating QR:** the server signs `{event, time, nonce}`; a QR is valid for 30 seconds.
2. **Scan record:** when a phone opens a fresh QR, the server records the scan against that phone and gives it a one-time voucher plus a personal claim link.
3. **Sign-in:** email plus a 6-digit key creates a wallet automatically.
4. **Claim checks:** the claim checks the geofence (GPS within the radius), checks that this phone hasn't already claimed for another account, and gives a risk score: forwarded link, different network, slow claim, repeated scans.
5. **Ledger:** every claim, revoke, reissue or geofence change is a block that stores the previous block's hash, so edits are detected.

**Tech stack and why.**
- Next.js + TypeScript: one codebase for phone, big screen and API.
- A PWA: scan and it opens.
- three.js: the 3D coin, lazy-loaded with a 2D fallback for weak phones.
- A tamper-evident ledger with ERC-5192 rules, and a Solidity ERC-5192 contract that is written and tested, ready for Base Sepolia once we have a funded testnet key.

**Demo, in order.**
1. Organizer dashboard → create event → set geofence ("use this room's location", 50 m).
2. Present mode: the QR rotates.
3. A judge scans → email → key → the 3D badge flies in.
4. Forward the claim link to a second phone and claim: Proxy Watch shows "SHARED BY" with the first judge's name.
5. On the first phone, sign in as a friend and try again: blocked, "device belongs to …".
6. The verify link shows "VERIFIED · SOULMARK LEDGER", plus Add to LinkedIn.

**What is tested.**
- 35 unit tests: ledger rules, tampering, QR forgery and expiry, sign-in limits, geofence inside/outside, sharer naming, second-account block, risk scores, honest stamp.
- 17 contract tests.
- An API smoke script and a real-browser test.

**Limitations.**
- Not on a public chain yet: you trust our server, and the stamp says so.
- GPS can be spoofed, and incognito resets the phone id; these checks are speed bumps backed by organizer review.
- Demo mode shows the key on screen; Google sign-in is pending.

**Likely judge questions.**
1. *How do you find who shared the QR?* Each scan is tied to the phone that made it, and the claim link carries that scan, so a forwarded link names the sharer on the dashboard.
2. *Can you stop proxy before it happens?* Yes, partly. Outside the geofence you can't claim, and one phone can't claim for two people; phones that keep re-scanning are flagged early.
3. *Is it on a blockchain?* The contract is written and tested (ERC-5192, EIP-712 vouchers); deploying needs a funded testnet key. Today's ledger is tamper-evident, and we say exactly that.
4. *What if indoor GPS is bad?* GPS accuracy up to 100 m is forgiven, the radius is adjustable, and the organizer can switch the geofence off live.
5. *Why three.js and not plain CSS?* Real lighting, depth and gyroscope tilt, loaded only when shown, with a CSS fallback for weak phones.

---

## Hinglish (about 2 minutes)

**Problem aur target user.** Certificates aur attendance abhi PDF ya Google Form pe hote hain. Fake karna easy hai, dost ke liye proxy lagana easy hai, aur verify karna slow hai. Hamare users hain organizers (classes, clubs, hackathons), attendees jinko apna real proof chahiye, aur recruiters jinko seconds mein check karna hai.

**Solution.** SoulMark har attendee ko soulbound badge deta hai jo kabhi transfer ya sell nahi ho sakta. Organizer ka QR har 20 second mein change hota hai, aur geofence se claim sirf room ke andar se hota hai. Attendee scan karta hai, email aur 6-digit key daalta hai, aur 3D badge wallet mein aa jaata hai. Agar koi proxy lagane ki koshish kare, toh Proxy Watch batata hai link kisne share kiya, aur jo phone doosre bande ke liye claim kare usko block kar deta hai.

**Kaise kaam karta hai.** Paanch parts:
1. **Rotating QR:** server `{event, time, nonce}` sign karta hai; QR 30 second valid hai.
2. **Scan record:** fresh QR kholte hi server us phone ka scan record karta hai aur ek one-time voucher plus personal claim link deta hai.
3. **Login:** email plus key se wallet ban jaata hai.
4. **Claim checks:** claim pe check hota hai ki GPS radius ke andar hai ya nahi, aur is phone ne pehle kisi aur account ke liye claim toh nahi kiya. Saath mein risk score milta hai: forwarded link, alag network, slow claim, baar-baar scan.
5. **Ledger:** har change ek block hai jo pichle block ka hash rakhta hai, toh edit pakda jaata hai.

**Tech stack aur kyun.**
- Next.js + TypeScript: phone, big screen aur API ek hi codebase mein.
- PWA: scan karo aur khul jaata hai.
- three.js: 3D coin, sirf zaroorat pe load hota hai, weak phones ke liye 2D fallback.
- ERC-5192 rules wala tamper-evident ledger, aur Solidity contract jo likha aur tested hai; funded testnet key milte hi Base Sepolia pe deploy hoga.

**Demo, order mein.**
1. Dashboard → event banao → geofence set karo ("use this room's location", 50 m).
2. Present mode: QR rotate hota hai.
3. Judge scan → email → key → 3D badge fly karke aata hai.
4. Claim link doosre phone pe forward karke claim karo: Proxy Watch mein "SHARED BY" pehle judge ka naam.
5. Pehle phone pe dost ke naam se login karke claim karo: blocked, "device belongs to …".
6. Verify link pe "VERIFIED · SOULMARK LEDGER" aur Add to LinkedIn.

**Kya tested hai.**
- 35 unit tests: ledger rules, tampering, QR forgery/expiry, login limits, geofence andar/bahar, sharer ka naam, second account block, risk score, honest stamp.
- 17 contract tests.
- API smoke script aur real-browser test.

**Limitations.**
- Abhi public chain pe nahi hai, toh server pe trust karna padta hai; stamp yahi saaf bolta hai.
- GPS spoof ho sakta hai, aur incognito phone id reset kar deta hai; ye checks speed bump hain, organizer review ke saath.
- Demo mode mein key screen pe dikhti hai; Google login pending hai.

**Judges ke likely sawaal.**
1. *QR share kisne kiya kaise pata chalega?* Har scan us phone se juda hai, aur claim link mein wahi scan hota hai, toh forward kiya link dashboard pe sharer ka naam dikhata hai.
2. *Proxy pehle se rok sakte ho?* Haan, kaafi had tak. Geofence ke bahar claim nahi hota, ek phone do logon ke liye claim nahi kar sakta, aur baar-baar scan karne wale phone pehle hi flag ho jaate hain.
3. *Blockchain pe hai?* Contract likha aur tested hai (ERC-5192, EIP-712 vouchers); deploy ke liye funded testnet key chahiye. Aaj ka ledger tamper-evident hai, aur hum yahi bolte hain.
4. *Indoor GPS kharab ho toh?* 100 m tak accuracy maaf hai, radius adjust hota hai, aur organizer geofence live off kar sakta hai.
5. *three.js kyun, CSS kyun nahi?* Real lighting, depth aur gyro tilt milta hai, sirf zaroorat pe load hota hai, aur weak phones ke liye CSS fallback hai.

---

## Round 2 changes

### Judges' comments
| # | Judge comment | What we changed | Files touched |
|---|---|---|---|
| 1 | Identify the person who's sharing the QR or link through which people mark proxy | Every QR scan is recorded against the phone that made it (`sm_device` cookie, scan id, IP, time). The claim link after a scan is personal (`/claim?t=…&s=scanId`). If it's opened on another phone, the claim gets risk 60 ("forwarded") and Proxy Watch shows **SHARED BY: handle (email)** of the phone that scanned | `lib/presence.ts` (new), `lib/http.ts`, `app/api/scan/route.ts`, `app/api/claim/route.ts`, `app/claim/page.tsx`, `app/api/events/[id]/integrity/route.ts` (new), `app/organizer/[id]/page.tsx` + `event.module.css` |
| 2 | Geofencing via the organizer dashboard, choosing a radius for a class | Dashboard **Geofence** card: "Use this room's location" (high-accuracy GPS), radius slider 25–1000 m with presets (Classroom 50 / Hall 150 / Campus 500), enable toggle, map link. The claim page asks for GPS only for geofenced events. The server accepts `distance ≤ radius + min(accuracy, 100 m)`; outside → 403, no location → fail closed. Changes are logged as `SET_GEOFENCE` ledger transactions | `lib/geo.ts` (new), `lib/types.ts`, `lib/ledger.ts`, `app/api/events/[id]/geofence/route.ts` (new), `app/api/claim/route.ts`, `app/claim/page.tsx`, `app/organizer/[id]/page.tsx` |
| 3 | Any way to detect the person who's going to mark proxy? | **Hard block:** the same phone claiming an event for a second account. The attempt is listed with "device belongs to …", which identifies the proxy marker. **Risk score** per claim (forwarded link, no scan on this phone, different network from the room, slow claim, repeated scans). **Early warning:** phones that keep re-scanning the QR. Median/p90 claim time and the count over 10 s | `lib/presence.ts`, `app/api/claim/route.ts`, `app/api/events/[id]/integrity/route.ts`, `app/organizer/[id]/page.tsx` |
| 4 | Make 3D badges instead of 2D | three.js coin with real thickness, iridescent faces carrying the deterministic art, orbiting colored lights, pointer and gyroscope tilt (iOS permission button), and a fly-in spin with a particle burst on claim. Lazy-loaded; the CSS badge stays as the fallback (no WebGL / reduced motion). The wallet shows the selected badge as a featured 3D coin (one canvas per screen) | `components/Badge3D.tsx` (new), `components/Badge3DLazy.tsx` (new), `app/claim/page.tsx`, `app/wallet/page.tsx` + `wallet.module.css`, `package.json` (`three`) |

### brief/FIXES.md items
| ID | Fix | Status | Why / note |
|---|---|---|---|
| F1 | ERC-5192 contract on Base Sepolia | Partial | `contracts/` with the Appendix A contract, 17 passing tests and a deploy script. **Not deployed:** needs a funded testnet key (human setup) |
| F2 | Relayer + mint queue | Skipped | Needs the deployed contract and a funded relayer key |
| F3 | Honest "verified" stamp | Done (current state) | The stamp reads "VERIFIED · SOULMARK LEDGER" and never says "on-chain" without a chain tx (unit test). `/api/check` returns `onChain:false, status, txHash`. Explorer renamed "Activity log" |
| F4 | HTTPS, Secure cookies, proxy-aware IP | Partial | `TRUST_PROXY` + Secure cookies done. The stable HTTPS tunnel URL is human setup |
| F5 | Continue with Google | Skipped | Needs a Google OAuth client ID + HTTPS origin |
| F6 | Real email delivery | Done (config-gated) | nodemailer SMTP when `SMTP_*` is set; not tried against a live SMTP server |
| F7 | Geofence | Done | Judge comment 2 |
| F8 | One claim per device per event + sign-in limit | Done | Device cap with proxy-marker identification; per-IP limit (default 20/10 min because classrooms share NAT; FIXES suggested 5); expired OTPs pruned |
| F9 | Claim-time metric | Done | Median / p90 / over 10 s on Proxy Watch |
| F10 | Gyro tilt / R3F | Done | Plain three.js instead of R3F (judge comment 4) |
| F11 | Share card + LinkedIn | Partial | "Add to LinkedIn" done; OG image not done |
| F12 | On-chain `tokenURI` | Skipped | Needs F1 deployed |
| F13 | CI | Done | GitHub Actions: typecheck, tests, build, contract tests |
| F14 | Cross-platform scripts | Partial | `npm run setup`, `npm run e2e` (auto-detects Edge/Chrome), `npm run smoke` still runs bash |
| F15 | Repo cleanup | Done | MIT LICENSE, new keys in `.env.example`, FIXES.md at root. Kit zip **kept** (organizer requirement). gitleaks not run |
| F16 | Trust model + threat table | Done | README: on-chain vs off-chain table, Mermaid flow, threat table; summary.md updated |

### Round 2 review fixes
An independent adversarial review of the Round 2 code found four real issues, all fixed and re-tested:
- Forged `X-Forwarded-For` could bypass the per-IP limits. Global ceilings were added; live test: 50 wrong PINs from 50 forged IPs lock the PIN.
- The proxy-block message was shown as "You already have this badge". Fixed.
- `/api/scan` could be flooded. It now keeps one record per phone per QR window, with rate limits.
- The geofence couldn't be switched off with a bad radius. Fixed.

### Known limitations / pending
- A forwarded link can be "laundered": removing `s=` drops it to a "watch" flag, and re-opening the QR token within ~30 s looks like a normal scan. The geofence and network signals still apply.
- Deploy the contract and wire the relayer (F1/F2/F12). Needs `ISSUER_PRIVATE_KEY` (testnet-only, funded) and `RPC_URL`.
- Google sign-in (F5) and SMTP credentials for real email (F6).
- A stable HTTPS URL for phones: geolocation, the in-app scanner and the service worker all need HTTPS.
- Presence checks can be beaten by GPS spoofing plus a fresh browser identity; they raise the cost of proxying and give the organizer evidence, not proof.
- Per-IP limits and the PIN lockout are in memory (reset on server restart); single-process JSON storage.
