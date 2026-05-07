/** UUID string form used as Graffiti channel ids (same as home chat ID validation). */
const CHANNEL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Builds a shareable URL that opens this app and joins the given channel (hash router).
 */
export function buildPartyupInviteLink(chatId) {
  if (typeof window === "undefined") return "";
  const id = String(chatId ?? "").trim();
  if (!CHANNEL_UUID_RE.test(id)) return "";
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/join/${encodeURIComponent(id)}`;
}

/**
 * Parses a pasted invite URL, hash path, query param, or bare UUID into a channel id, or null.
 */
export function extractChatIdFromInviteInput(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (CHANNEL_UUID_RE.test(s)) return s;

  const hashJoin = s.match(/#\/?join\/([0-9a-f-]{36})/i);
  if (hashJoin && CHANNEL_UUID_RE.test(hashJoin[1])) return hashJoin[1];

  const hashChat = s.match(/#\/?chat\/([0-9a-f-]{36})/i);
  if (hashChat && CHANNEL_UUID_RE.test(hashChat[1])) return hashChat[1];

  try {
    const base = typeof window !== "undefined" ? window.location.href : "https://example.com/";
    const u = new URL(s, base);
    const hj = u.hash.match(/#\/?join\/([0-9a-f-]{36})/i);
    if (hj && CHANNEL_UUID_RE.test(hj[1])) return hj[1];
    const hc = u.hash.match(/#\/?chat\/([0-9a-f-]{36})/i);
    if (hc && CHANNEL_UUID_RE.test(hc[1])) return hc[1];
    const q = u.searchParams.get("join");
    if (q && CHANNEL_UUID_RE.test(q.trim())) return q.trim();
  } catch {
    /* ignore */
  }

  const anywhere = s.match(UUID_IN_TEXT);
  return anywhere && CHANNEL_UUID_RE.test(anywhere[0]) ? anywhere[0] : null;
}
