import { getKnownChatsOwnerKey } from "./known-chats.js";

const STORAGE_KEY = "partyup-coplay";
const MAX_ROWS = 40;

export function loadCoplayStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

export function saveCoplayStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn("partyup-coplay: save failed", e);
  }
}

/**
 * Remember actors seen in this chat (from message/join profile metadata) for quick invite copy later.
 * Excludes the session actor; skips when join-blocked (spectating full/banned room without participating).
 */
export function recordCoplayActors(session, channelId, directoryMap, joinBlocked) {
  if (joinBlocked) return;
  const ownerKey = getKnownChatsOwnerKey(session);
  const ch = String(channelId ?? "").trim();
  if (!ownerKey || !ch || !directoryMap || !(directoryMap instanceof Map)) return;

  const store = loadCoplayStore();
  const prevList = Array.isArray(store[ownerKey]) ? store[ownerKey] : [];
  const byActor = new Map(prevList.map((r) => [r.actorId, { ...r }]));
  const now = Date.now();

  for (const meta of directoryMap.values()) {
    const aid = meta?.actor;
    if (!aid || aid === ownerKey) continue;
    const displayName = String(meta.name || "").trim() || "Unknown user";
    byActor.set(aid, {
      actorId: aid,
      displayName,
      lastSeenAt: now,
      lastChannel: ch,
    });
  }

  const next = [...byActor.values()]
    .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))
    .slice(0, MAX_ROWS);
  store[ownerKey] = next;
  saveCoplayStore(store);
}

/** Recent co-players for the Invite sidebar (newest first). */
export function getCoplayActorsForSidebar(session, limit = 15) {
  const ownerKey = getKnownChatsOwnerKey(session);
  if (!ownerKey) return [];
  const store = loadCoplayStore();
  const list = Array.isArray(store[ownerKey]) ? store[ownerKey] : [];
  const cap = Math.min(MAX_ROWS, Math.max(0, Number(limit) || 15));
  return list.filter((r) => r.actorId && r.actorId !== ownerKey).slice(0, cap);
}
