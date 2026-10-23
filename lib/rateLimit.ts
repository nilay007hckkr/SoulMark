/** Fixed-window counter: returns false once `limit` hits for `key` happened inside `windowMs`. */
export function allowHit(map: Map<string, { count: number; since: number }>, key: string, nowMs: number, limit: number, windowMs: number): boolean {
  const rec = map.get(key);
  if (!rec || nowMs - rec.since > windowMs) {
    map.set(key, { count: 1, since: nowMs });
    return true;
  }
  if (rec.count >= limit) return false;
  rec.count += 1;
  return true;
}
