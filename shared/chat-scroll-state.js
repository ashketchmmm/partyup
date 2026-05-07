const STORAGE_KEY = "partyup-chat-scroll-pos";

function readStore() {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* ignore quota */
  }
}

/**
 * @returns {number | null} Scroll ratio in [0, 1] (scrollTop / maxScroll), or null if unset.
 */
export function loadScrollRatio(actorId, channelId) {
  if (!actorId || !channelId) return null;
  const store = readStore();
  const ratio = store?.[actorId]?.[channelId]?.ratio;
  if (typeof ratio !== "number" || Number.isNaN(ratio)) return null;
  return Math.min(1, Math.max(0, ratio));
}

export function saveScrollRatio(actorId, channelId, ratio) {
  if (!actorId || !channelId) return;
  const r = typeof ratio === "number" && !Number.isNaN(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  const store = readStore();
  if (!store[actorId]) store[actorId] = {};
  store[actorId][channelId] = { ratio: r, updatedAt: Date.now() };
  writeStore(store);
}
