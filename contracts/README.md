# SoulMark contracts

Isolated Hardhat subproject (own `package.json`) holding `SoulMark.sol`: an ERC-721 + ERC-5192 soulbound badge minted only with an issuer-signed EIP-712 voucher; transfers and approvals revert, the issuer can revoke/reissue.

- Test: `cd contracts; npm install; npm test`
- Compile only: `npm run compile` (solc 0.8.24, optimizer on, EVM target `cancun` because OpenZeppelin >= 5.2 uses `mcopy`).
- Deploy: set `ISSUER_PRIVATE_KEY` (testnet-only key, funded from a Base Sepolia faucet) and optionally `RPC_URL` in the root `.env`, then `npm run deploy:base-sepolia`. The address is written to `../deployments/base-sepolia.json`.
- The deploy script refuses to run on Base Sepolia without `ISSUER_PRIVATE_KEY`; secrets are read from the environment and never printed.
- On-chain `eventId` is `keccak256(appEventId)`; never put personal data on-chain.
- Status: not deployed yet, and the app does not call the contract yet (relayer, FIXES.md F2, pending).
