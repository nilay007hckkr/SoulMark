// Shared shapes for the SoulMark ledger, API and UI.

export type TxType = "CREATE_EVENT" | "CLAIM" | "REVOKE" | "REISSUE";

export interface EventRecord {
  id: string; // "evt_" + 8 hex
  name: string;
  date: string; // YYYY-MM-DD
  venue: string;
  description: string;
  issuer: string; // organizer display name
  issuerAddress: string; // 0x… address of the issuing organizer
  claimStart: string; // ISO time
  claimEnd: string; // ISO time
  createdAt: string; // ISO time
}

export interface Badge {
  tokenId: number;
  eventId: string;
  owner: string; // 0x… wallet
  issuedAt: string; // ISO time
  txHash: string;
  blockNumber: number;
  revoked: boolean;
  revokedAt?: string;
  reissuedFrom?: number; // tokenId this badge replaced
}

export interface Tx {
  hash: string;
  type: TxType;
  from: string;
  data: Record<string, string | number>;
  timestamp: string;
}

export interface Block {
  number: number;
  hash: string;
  prevHash: string;
  timestamp: string;
  txs: Tx[];
}

export interface LedgerState {
  blocks: Block[];
  events: EventRecord[];
  badges: Badge[];
  usedNonces: Record<string, number>; // nonce -> expiry ms
}

export interface BadgeArt {
  hueA: number;
  hueB: number;
  angle: number;
  rings: number;
  rotation: number;
  pattern: "rings" | "grid" | "rays";
  code: string; // short 6-char fingerprint shown on the badge
}
