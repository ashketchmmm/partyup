const KNOWN_CHATS_STORAGE_KEY = "partyup-known-chats";

export function loadAllKnownChats() {
  try {
    const storedChats = localStorage.getItem(KNOWN_CHATS_STORAGE_KEY);
    if (!storedChats) return {};
    const parsedChats = JSON.parse(storedChats);
    return parsedChats && typeof parsedChats === "object" ? parsedChats : {};
  } catch (e) {
    console.warn("partyup-known-chats: load failed", e);
    return {};
  }
}

export function saveAllKnownChats(allKnownChats) {
  try {
    localStorage.setItem(KNOWN_CHATS_STORAGE_KEY, JSON.stringify(allKnownChats));
  } catch (e) {
    console.warn("partyup-known-chats: save failed", e);
  }
}

/** Stable storage key for the logged-in user (never "anonymous"). */
export function getKnownChatsOwnerKey(session) {
  if (!session) return null;
  const raw = session.actor;
  if (typeof raw === "string") {
    const s = raw.trim();
    return s.length > 0 ? s : null;
  }
  if (raw != null && typeof raw === "object") {
    for (const k of ["id", "actor", "handle", "username"]) {
      const v = raw[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  if (raw != null && typeof raw !== "object") {
    const s = String(raw).trim();
    return s.length > 0 ? s : null;
  }
  return null;
}

/**
 * Read-only: do not mutate `allKnownChats` here (was breaking Vue computed reactivity
 * when used from a computed getter).
 */
export function getCurrentUserKnownChats(allKnownChats, session) {
  const ownerKey = getKnownChatsOwnerKey(session);
  if (!ownerKey) return [];
  const knownChatsForUser = allKnownChats[ownerKey];
  return Array.isArray(knownChatsForUser) ? knownChatsForUser : [];
}

/** Fallback label when we have a channel id but no title yet. */
export function defaultKnownChatTitle(channelId) {
  const id = String(channelId ?? "").trim();
  if (!id) return "Chat";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)) {
    return `Chat (${id.slice(0, 8)}…)`;
  }
  return "Chat";
}

export function removeKnownChat(allKnownChats, session, channelId) {
  const chatChannel = typeof channelId === "string" ? channelId.trim() : "";
  if (!chatChannel) return;
  const ownerKey = getKnownChatsOwnerKey(session);
  if (!ownerKey || !Array.isArray(allKnownChats[ownerKey])) return;
  const userKnownChats = allKnownChats[ownerKey];
  const idx = userKnownChats.findIndex((chat) => String(chat?.channel ?? "").trim() === chatChannel);
  if (idx >= 0) {
    userKnownChats.splice(idx, 1);
    saveAllKnownChats(allKnownChats);
  }
}

export function addKnownChat(allKnownChats, session, chatInfo) {
  const chatChannel = chatInfo.channel?.trim();
  if (!chatChannel) return;
  const ownerKey = getKnownChatsOwnerKey(session);
  if (!ownerKey) return;
  if (!Array.isArray(allKnownChats[ownerKey])) {
    allKnownChats[ownerKey] = [];
  }
  const userKnownChats = allKnownChats[ownerKey];
  const existingIndex = userKnownChats.findIndex((chat) => String(chat?.channel ?? "").trim() === chatChannel);
  const prev = existingIndex >= 0 ? userKnownChats[existingIndex] : null;
  const nextChat = {
    channel: chatChannel,
    title:
      chatInfo.title?.trim() ||
      (prev?.title && String(prev.title).trim()) ||
      defaultKnownChatTitle(chatChannel),
    players:
      typeof chatInfo.players === "number"
        ? chatInfo.players
        : prev && typeof prev.players === "number"
          ? prev.players
          : null,
    ...(chatInfo.game != null && String(chatInfo.game).trim()
      ? { game: String(chatInfo.game).trim() }
      : prev?.game != null && String(prev.game).trim()
        ? { game: String(prev.game).trim() }
        : {}),
  };
  if (chatInfo.spectator !== undefined) {
    if (chatInfo.spectator) nextChat.spectator = true;
  } else if (prev?.spectator) {
    nextChat.spectator = true;
  }
  if (existingIndex >= 0) {
    const merged = { ...userKnownChats[existingIndex], ...nextChat };
    if (chatInfo.spectator !== undefined && !chatInfo.spectator) delete merged.spectator;
    userKnownChats[existingIndex] = merged;
  } else {
    userKnownChats.unshift(nextChat);
  }
  saveAllKnownChats(allKnownChats);
}

/** Whether this chat is bookmarked as spectator-only until "Join as Player". */
export function lookupKnownChatSpectator(session, channelId) {
  const id = String(channelId ?? "").trim();
  if (!id) return false;
  const all = loadAllKnownChats();
  const list = getCurrentUserKnownChats(all, session);
  const hit = list.find((c) => String(c?.channel ?? "").trim() === id);
  return Boolean(hit?.spectator);
}

export function lookupKnownChatTitle(session, channelId) {
  if (!channelId) return null;
  const id = String(channelId).trim();
  const all = loadAllKnownChats();
  const list = getCurrentUserKnownChats(all, session);
  const hit = list.find((c) => String(c?.channel ?? "").trim() === id);
  return hit?.title ?? null;
}

export function lookupKnownChatPlayers(session, channelId) {
  if (!channelId) return null;
  const id = String(channelId).trim();
  const all = loadAllKnownChats();
  const list = getCurrentUserKnownChats(all, session);
  const hit = list.find((c) => String(c?.channel ?? "").trim() === id);
  return hit?.players ?? null;
}
