# SoulMark: Round 2 Fix Plan

These fixes are based on three sources:

- the problem brief (`PROBLEM_2_Proof_of_Attendance.md`);
- the repo `README.md`;
- the repo `summary.md`.

I have not read the `lib/` and `app/api/` source files. File names below are where each change most likely lands, so confirm them before editing.

Fixes are in priority order. **P0** items close the gap between what the brief requires and what is built. **P1** items close the anti-fraud holes. **P2** items are the brief's "wow" features. **P3** is repo hygiene.

---

## How to use this file

1. Commit this file to the repo root as `FIXES.md`.
2. One teammate starts Claude Code with the prompt in **Appendix C**.
3. At the same time, the others do the **Human setup** steps. Claude Code can't do these.

---

## Already fixed in Round 1 (don't redo)

According to `summary.md`, these are done:

- organizer PIN lockout after 10 wrong tries;
- `DEMO_MODE=true` must be set explicitly;
- atomic JSON writes, with no overwrite of a corrupt `ledger.json`;
- a second reissue returns 409;
- a revoked wallet can't re-claim (returns 403);
- `verifyChain` replays REVOKE and CREATE_EVENT;
- the OTP attempt counter carries over between requests;
- the QR refresh loop is fixed;
- the voucher cookie is set on the correct host.

---

## Overview

| ID | Fix | Why (brief section) | Effort | Priority |
|----|-----|---------------------|--------|----------|
| F1 | Real ERC-5192 contract on Base Sepolia | MVP #1, §6 Smart contract | M | P0 |
| F2 | Relayer + mint queue (gasless claim) | Feature #4, Success criterion 1 | M | P0 |
| F3 | Honest "Verified on-chain" stamp + explorer link | Feature #6, Demo step 4 | S | P0 |
| F4 | HTTPS public URL, Secure cookies, proxy-aware IPs | Success criterion 4, scanner/PWA need HTTPS | S | P0 |
| F5 | "Continue with Google" | Feature #4, Demo step 2 | M | P1 |
| F6 | Real email delivery for the fallback path | §12 Risks (identity) | S | P1 |
| F7 | Optional geofence per event | §6 Rotating QR step 4, §12 Risks | M | P1 |
| F8 | One claim per device per event + sign-in rate limit | Anti-farming; known limitation | S | P1 |
| F9 | Live claim-time metric (target < 10 s) | Success criterion 1 | S | P1 |
| F10 | Gyroscope tilt on the badge (R3F optional) | §5 Wow factor | S–M | P2 |
| F11 | Share card + "Add to LinkedIn" | §5 Wow factor | S | P2 |
| F12 | On-chain `tokenURI` with deterministic art | §5 Deterministic art, §6 Metadata | M | P2 |
| F13 | GitHub Actions CI | Reproducibility | S | P3 |
| F14 | Cross-platform scripts | Judges may not use Windows | S | P3 |
| F15 | Repo cleanup | First impression | S | P3 |
| F16 | README: trust model + threat table | Honesty, judging | S | P3 |

Effort is a rough guide for Claude Code-assisted work: S is under 30 min, M is 30–90 min, L is over 90 min. Re-estimate after F1, because it is the riskiest item.

---

## Human setup (do in parallel)

- [ ] **Testnet-only issuer key.** Generate a brand-new key that has never held real funds. Put it in `.env` as `ISSUER_PRIVATE_KEY`, and never paste it into chat, code or commits.
- [ ] **Fund the key** from a Base Sepolia faucet. Testnet gas is cheap, so a single faucet drip is usually enough for a demo.
- [ ] **Stable HTTPS URL** for the laptop running the app. A tunnel with a fixed hostname (an ngrok static domain or a named Cloudflare tunnel) works. A random quick-tunnel URL breaks Google sign-in every time it changes.
- [ ] **Google OAuth Web client ID.** In the Google Cloud console, set the authorized JavaScript origin to the HTTPS URL. Then either publish the consent screen (basic scopes only: `openid email profile`) or add the judges as test users. Check the console's current rules.
- [ ] **SMTP credentials** for the email fallback, for example a Gmail app password (needs 2FA). Put them in `.env` only. Skip this if you go Google-only.
- [ ] *(Optional)* **Explorer API key**, so the contract source is verified and judges can read it on the explorer.
- [ ] Confirm `.env` is listed in `.gitignore`.

---

## P0: Must fix (the brief asks for a blockchain dApp)

### F1. Real soulbound contract on Base Sepolia

**Why.** The brief is "Problem 2 | Blockchain", and MVP item #1 is a soulbound smart contract. Today the ledger is a local JSON hash chain, which the operator can rewrite. This is the single biggest gap.

**Change:**

- Add `contracts/SoulMark.sol` (Appendix A). It uses OpenZeppelin Contracts v5 and implements ERC-5192:
  - `claim(to, eventId, deadline, sig)`, which needs an issuer-signed EIP-712 voucher;
  - issuer-only `revoke` and `reissue`;
  - `hasBadge`, and `locked()` returning `true`;
  - every transfer and approval reverts.
- Tooling:
  - **Hardhat** is pure npm and simplest on Windows.
  - **Foundry** has faster tests and is easiest under WSL.
  - Pick one and don't mix them.
- Add a deploy script that writes the contract address to `deployments/base-sepolia.json`. That file is public and fine to commit.
- On-chain `eventId` is `keccak256(appEventId)`. **Never put emails, names or other personal data on-chain.** Chain data is public and permanent.
- Check how `lib/auth.ts` creates the "embedded wallet":
  - If it is random hex, it is a valid receiving address. Soulbound tokens never need to sign, so this works, but nobody holds its key. Call it a "custodial address" in docs.
  - A real embedded-wallet provider (Privy, thirdweb, Web3Auth) is out of scope this round.
- Trade-off to state openly: the issuer key and the relayer key are the same key for now. The real gain is that **issued history becomes public and immutable**. The operator can still authorize issuance, which is intended, since the organizer is the issuer. The operator can no longer silently rewrite past badges.

**Done when:**

- Contract tests pass (see "Tests to add").
- The contract is deployed to Base Sepolia.
- The address is in `deployments/base-sepolia.json`.
- *(Optional)* The source is verified on the explorer.

### F2. Relayer + mint queue (gasless, still fast)

**Why.** Success criterion 1 is "a badge in under 10 seconds with no gas prompt". Waiting for a block inside the HTTP request would make claims slow and fragile.

**Change:**

- `lib/chain.ts` (Appendix B) uses viem with the `baseSepolia` chain and `RPC_URL`. The public endpoint `https://sepolia.base.org` is rate-limited, so use a provider URL if you have one.
- Claim API:
  1. Keep **all existing checks**: QR voucher, session, revoked, duplicate.
  2. Write the ledger entry with `status: "pending"`.
  3. Enqueue the mint.
  4. Return immediately. The UI shows the badge with "Confirming on Base…".
- In-process worker:
  - Send transactions **one at a time** to avoid nonce clashes. Use viem's nonce manager or track the nonce yourself.
  - Don't wait for one receipt before sending the next transaction. Poll receipts separately.
  - **Re-sign the voucher on every retry**, because the deadline may have passed.
  - Retry with backoff. On success, set `status: "confirmed"` with `txHash` and `blockNumber`. After N failures, set `status: "failed"` and show it on the organizer dashboard.
- Organizer revoke/reissue buttons also call the contract, through the same queue.
- Show the relayer's balance on the dashboard, with a low-balance warning.
- Assumption: a single Node process (`npm start`). Don't run multiple instances with this in-process queue.
- Tell judges this is relayer-sponsored gas. An ERC-4337 paymaster is the next step. The brief says "paymaster", so be explicit about the difference.

**Done when:**

- 20 parallel claims all confirm with no nonce errors.
- The claim HTTP response takes under 1 s.
- With a broken `RPC_URL`, claims stay `pending` and recover once it's fixed.

### F3. Honest "Verified on-chain" stamp

**Why.** The verify page currently says "VERIFIED ON-CHAIN" for an off-chain record. A judge who checks will mark this as misleading.

**Change (`app/verify/...`, `/api/check`):**

- The stamp has three states:
  - **Confirmed:** "Verified on-chain · Base Sepolia", with a link to the transaction on the explorer (`https://sepolia.basescan.org/tx/<hash>`) and to the contract.
  - **Pending:** "Recorded · confirming on chain".
  - **Revoked:** "Revoked".
- The verify page reads `hasBadge` from the chain. A cached value is fine for speed, but it must be labelled as cached.
- Rename "Ledger explorer" to "Activity log" and link out to the block explorer for on-chain truth.
- `/api/check` returns `{ hasBadge, onChain, status, txHash }`.

**Done when:** a test proves the stamp never says "on-chain" without a confirmed `txHash`.

### F4. HTTPS, Secure cookies, proxy-aware client IP

**Why.**

- The in-app camera scanner, service worker, geolocation (F7) and Google sign-in (F5) all need HTTPS. `summary.md` already notes this for the scanner.
- Behind a tunnel, every request arrives from `127.0.0.1`. One attacker could then trip the PIN lockout for everyone, and per-IP limits stop working.

**Change:**

- Set `PUBLIC_BASE_URL=https://<stable-host>` so the QR encodes the HTTPS URL.
- Add the `Secure` flag to session, voucher and device cookies whenever the base URL is HTTPS. Keep `SameSite=Lax`.
- Add `TRUST_PROXY=true|false`. Only when it is true, read the client IP from the header your tunnel sets:
  - `CF-Connecting-IP` for Cloudflare;
  - otherwise, the right-most `X-Forwarded-For` entry added by your proxy.
  - Never trust these headers when `TRUST_PROXY` is false, because clients can spoof them.

**Done when:**

- On a mid-range Android phone over the HTTPS URL, the in-app scanner opens and the service worker registers.
- Locking out one IP doesn't lock out another.

---

## P1: Identity and presence (the anti-fraud holes)

### F5. "Continue with Google"

**Why.** The brief's claim flow and demo script both say "Continue with Google". It is also the fastest way to meet the under-10-second target.

**Change:**

- Add the Google Identity Services button (and One Tap) on login/claim.
- The server verifies the ID token with `google-auth-library` `verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })`, and requires `email_verified === true`.
- After that, use the **same session path** as the email-key flow, mapped by the lower-cased verified email so both paths share one account.
- This approach needs no redirect URI, only the authorized JavaScript origin.

**Done when:** a new user claims with Google on Android, and F9 shows a median under 10 s.

### F6. Real email for the fallback path

**Change:**

- Send the 6-digit key with `nodemailer` over SMTP, using `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM`.
- Run every judged demo with `DEMO_MODE=false`.
- If SMTP isn't configured and `DEMO_MODE=false`, hide the email option instead of failing.

**Done when:** the key arrives by email, and no key is ever shown on screen when `DEMO_MODE=false`.

### F7. Optional geofence per event

**Why.** The brief lists "Optional: a geofence check at claim time". It also makes the remaining hole, a link forwarded within about 30 s, harder to exploit.

**Change:**

- The event gets an optional `{ lat, lng, radiusM }` (default about 150 m), set with a "Use this room's location" button on the organizer page.
- For geofenced events only, the claim page asks for location with `enableHighAccuracy`.
- The server computes the haversine distance and accepts `distance <= radiusM + min(accuracy, 100)`.
- If the user denies permission, fail closed with a clear message.
- The organizer can switch the geofence off live if indoor GPS is bad.
- Be honest: GPS can be spoofed. This is a speed bump, not proof.

**Done when:**

- Unit tests with fake coordinates show inside passes and outside is rejected.
- Two phones in the room both pass.

### F8. One claim per device per event + sign-in rate limit

**Change:**

- Set an `sm_device` cookie (random 128-bit, httpOnly, Secure, 1-year).
- A second claim for the same event from the same device returns 409 with a plain message. The organizer can override with reissue.
- Add a per-IP limit on key/OTP requests, for example 5 per 10 min.
- Prune expired entries so `auth.json` can't grow without bound. This fixes a known limitation from `summary.md`.
- Be honest: incognito mode or clearing cookies gets around the device cap. It stops casual badge farming, not a determined attacker.

**Done when:** tests cover the second claim from the same device (409) and the sixth OTP request (429).

### F9. Live claim-time metric

**Why.** Success criterion 1 ("under 10 seconds") is measurable, so show the number live.

**Change:**

- Store `voucherIssuedAt` (at scan) and `claimedAt`.
- The organizer dashboard shows median and p90 claim time, plus the count of claims over 10 s.
- This measures server-side time from scan to claim, which is a lower bound on the user's experience. Also time one real claim with a stopwatch.

---

## P2: The brief's "wow" items (only after P0 and P1)

### F10. Gyroscope tilt on the badge

- Drive the CSS badge's `rotateX`/`rotateY` from `DeviceOrientationEvent`.
- iOS requires `DeviceOrientationEvent.requestPermission()` from a tap.
- Use pointer tilt on desktop.
- Respect `prefers-reduced-motion`.
- React Three Fiber only if time is left:
  - lazy-load it with `next/dynamic` and `ssr: false`, on the claim moment only;
  - keep the CSS badge as the fallback;
  - follow the brief's §8 performance rules.
- Defend the Round 1 choice of a CSS badge for weak phones. Gyro tilt closes most of the gap cheaply.

### F11. Share card + "Add to LinkedIn"

- Add `opengraph-image.tsx` for the verify route, using `next/og` `ImageResponse`.
- The "Add to LinkedIn" button uses LinkedIn's Add-to-Profile certification link, with name, organization, issue month/year, and `certUrl` set to the verify link. Check the current parameter names in LinkedIn's docs.

### F12. On-chain `tokenURI` with deterministic art

- Add an issuer-only `createEvent(eventId, name, date)` that stores the event name and date.
- `tokenURI` returns base64 JSON with an SVG whose pattern is seeded from `keccak256(eventId, wallet)`.
- This makes "art provably tied to on-chain data" literally true.
- It costs no gas for viewers; storage is paid once per event.

---

## P3: Hygiene

### F13. CI

Add `.github/workflows/ci.yml`. It should run on `ubuntu-latest` with Node 24 and do the following:

- `npm ci`
- `npx tsc --noEmit -p .`
- `npm test`
- the contract tests

It needs no secrets.

### F14. Cross-platform scripts

- `npm run setup`: a Node script that copies `.env.example` to `.env`.
- `npm run smoke`: port `smoke.sh` to Node so it no longer needs Git Bash.
- `npm run e2e`: read the browser path from `BROWSER_PATH`, auto-detecting Chrome or Edge.

### F15. Repo cleanup

- Remove `ai-prompt-governance-kit.zip` unless the organizers require it in the repo.
- Add a `LICENSE` (MIT).
- Add a repo description and topics.
- Run `gitleaks detect` on the history.
- Add every new env var to `.env.example` with empty values.

### F16. README: trust model and threat table

- Add a short "What's on-chain vs off-chain" table.
- Add a Mermaid architecture diagram.
- Add a threat table with the columns: attack → defence → residual risk. Include:
  - forwarded QR link;
  - proxy claim with someone else's email;
  - badge farming from one device;
  - operator rewriting history;
  - lost key or wallet.
- Update `summary.md` limitations so they match the new state.

---

## Tests to add

| Test | Expected |
|------|----------|
| `transferFrom` / `safeTransferFrom` / `approve` / `setApprovalForAll` | Revert `Soulbound` |
| Claim twice, same wallet + event | Revert `AlreadyHasBadge` |
| Voucher past deadline | Revert `VoucherExpired` |
| Voucher signed by a non-issuer key | Revert `BadSignature` |
| Replay a used voucher after revoke | Revert `VoucherUsed` |
| `revoke` / `reissue` from a non-issuer | Revert `NotIssuer` |
| `supportsInterface(0xb45a3c0e)` | `true` |
| Mint emits `Locked(tokenId)` | Event emitted |
| Verify stamp without confirmed `txHash` | Never shows "on-chain" |
| 20 parallel claims through the queue | All confirm, no nonce errors |
| Geofence: outside radius | Rejected |
| Second claim, same device, same event | 409 |
| 6th OTP request within window | 429 |
| Expired / forged QR payload | Rejected (keep the existing tests) |

---

## Demo-day checklist

- [ ] `DEMO_MODE=false`, the HTTPS URL is live, and `PUBLIC_BASE_URL` is set.
- [ ] The relayer has enough balance. Check the dashboard warning.
- [ ] Pre-create the demo event and pre-claim 2 badges, so the verify step works even if the RPC is slow.
- [ ] Rehearse on a **mid-range Android** over the HTTPS URL (success criterion 4), and time it.
- [ ] Fallbacks:
  - If the RPC fails, badges show "confirming" and catch up later.
  - If the tunnel fails, use the LAN URL with the paste-link path.

## What to tell judges (honest framing)

- Badges are ERC-5192 tokens on Base Sepolia.
- Transfers revert on-chain, and anyone can verify through the contract or the explorer.
- Issuance needs our issuer's signature. That is the intended trust point, because the organizer is the issuer.
- Gas is paid by our relayer.
- Presence is checked with a rotating signed QR, an optional geofence, and one claim per device.
- The residual risk is a link forwarded within about 30 s to someone who spoofs GPS.

## Out of scope this round

ZK proofs, Merkle/CSV bulk issuance, tiers, NFC, W3C VCs, a real ERC-4337 paymaster, and a third-party embedded-wallet provider. Do these only after P0 and P1 are done.

---

## Appendix A: Contract sketch

This is a sketch. Compile it, test it, and only then trust it.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IERC5192 {
    event Locked(uint256 tokenId);
    event Unlocked(uint256 tokenId);
    function locked(uint256 tokenId) external view returns (bool);
}

contract SoulMark is ERC721, EIP712, IERC5192 {
    bytes32 private constant CLAIM_TYPEHASH =
        keccak256("Claim(address to,bytes32 eventId,uint256 deadline)");

    address public immutable issuer;
    uint256 private _nextId = 1;

    mapping(address => mapping(bytes32 => uint256)) public badgeOf; // wallet => eventId => tokenId (0 = none)
    mapping(uint256 => bytes32) public eventOf;                      // tokenId => eventId
    mapping(bytes32 => bool) public usedVoucher;                     // EIP-712 digest => used

    error Soulbound();
    error NotIssuer();
    error AlreadyHasBadge();
    error VoucherExpired();
    error VoucherUsed();
    error BadSignature();

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert NotIssuer();
        _;
    }

    constructor(address issuer_) ERC721("SoulMark", "SOUL") EIP712("SoulMark", "1") {
        issuer = issuer_;
    }

    /// Anyone may submit (our relayer, or later the attendee's own wallet);
    /// the issuer's EIP-712 signature is what authorises the mint.
    function claim(address to, bytes32 eventId, uint256 deadline, bytes calldata sig)
        external
        returns (uint256)
    {
        if (block.timestamp > deadline) revert VoucherExpired();
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(CLAIM_TYPEHASH, to, eventId, deadline))
        );
        // Marking vouchers used stops a voucher from being replayed after a revoke.
        if (usedVoucher[digest]) revert VoucherUsed();
        if (ECDSA.recover(digest, sig) != issuer) revert BadSignature();
        usedVoucher[digest] = true;
        return _issue(to, eventId);
    }

    function revoke(uint256 tokenId) external onlyIssuer {
        address holder = _requireOwned(tokenId);
        delete badgeOf[holder][eventOf[tokenId]];
        delete eventOf[tokenId];
        _burn(tokenId);
    }

    function reissue(uint256 oldTokenId, address newWallet) external onlyIssuer returns (uint256) {
        address holder = _requireOwned(oldTokenId);
        bytes32 eventId = eventOf[oldTokenId];
        delete badgeOf[holder][eventId];
        delete eventOf[oldTokenId];
        _burn(oldTokenId);
        return _issue(newWallet, eventId);
    }

    function hasBadge(address wallet, bytes32 eventId) external view returns (bool) {
        return badgeOf[wallet][eventId] != 0;
    }

    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC5192).interfaceId // 0xb45a3c0e
            || super.supportsInterface(interfaceId);
    }

    // Soulbound: only mint (from == 0) and burn (to == 0) may move a token.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override { revert Soulbound(); }
    function setApprovalForAll(address, bool) public pure override { revert Soulbound(); }

    function _issue(address to, bytes32 eventId) private returns (uint256 tokenId) {
        if (badgeOf[to][eventId] != 0) revert AlreadyHasBadge();
        tokenId = _nextId++;
        badgeOf[to][eventId] = tokenId;
        eventOf[tokenId] = eventId;
        _mint(to, tokenId); // _mint, not _safeMint: no receiver callback, smaller attack surface
        emit Locked(tokenId);
    }
}
```

Design notes:

- `reissue(oldTokenId, newWallet)` is more precise than the brief's `reissue(eventId, newWallet)`, because it names exactly which badge moves.
- With one key acting as both issuer and relayer, a leaked key lets someone mint any badge. Splitting the keys is the next step: an issuer key that only signs and a relayer key that only pays gas. That requires making `revoke`/`reissue` voucher-based too.

## Appendix B: Server-side signing and sending (viem sketch)

Check this against viem's current docs.

```ts
// lib/chain.ts — server only
import { createPublicClient, createWalletClient, http, keccak256, toHex,
         type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { soulMarkAbi } from "./soulMarkAbi"; // generated from the compiled contract

const account = privateKeyToAccount(process.env.ISSUER_PRIVATE_KEY as Hex);
const transport = http(process.env.RPC_URL ?? "https://sepolia.base.org");
export const publicClient = createPublicClient({ chain: baseSepolia, transport });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport });
const CONTRACT = process.env.SOULMARK_CONTRACT as Address;

export const toEventId = (appEventId: string) => keccak256(toHex(appEventId));

/** Sign a fresh voucher and send the claim tx. Call from a serial queue. */
export async function sendClaim(to: Address, appEventId: string): Promise<Hex> {
  const eventId = toEventId(appEventId);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
  const signature = await account.signTypedData({
    domain: { name: "SoulMark", version: "1", chainId: baseSepolia.id, verifyingContract: CONTRACT },
    types: {
      Claim: [
        { name: "to", type: "address" },
        { name: "eventId", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Claim",
    message: { to, eventId, deadline },
  });
  return walletClient.writeContract({
    address: CONTRACT,
    abi: soulMarkAbi,
    functionName: "claim",
    args: [to, eventId, deadline, signature],
  });
}
// The worker then: publicClient.waitForTransactionReceipt({ hash }) → mark confirmed.
```

New `.env.example` keys, all with empty values:

- `ISSUER_PRIVATE_KEY`
- `RPC_URL`
- `SOULMARK_CONTRACT`
- `GOOGLE_CLIENT_ID`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `TRUST_PROXY`
- `PUBLIC_BASE_URL`

## Appendix C: One Claude Code prompt for P0 + P1

```
Read FIXES.md, README.md and summary.md. Implement F1–F9 in order (P0, then P1),
then F13–F16. Do not start P2 unless I ask.

Before writing code, ask me every open decision from FIXES.md as multiple-choice
questions in one batch (e.g. Hardhat vs Foundry, Google + email vs Google only,
geofence default on/off, default radius).

Rules:
- Never commit .env, private keys or any secret; read secrets only from the env
  vars listed in FIXES.md Appendix B, and add them to .env.example with empty values.
- Keep every existing test green. Add every test in "Tests to add".
- After each fix run: npm test, npx tsc --noEmit -p ., and the contract tests.
  Fix failures before moving on.
- Never label anything "on-chain" unless it has a confirmed Base Sepolia tx.
- Update README.md and summary.md so they state exactly what is on-chain and what is not.
- At the end, print a table of F1–F16 with status (done / partial / skipped and why)
  and list everything I must still do by hand.
```
