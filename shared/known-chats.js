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
  if (typeof raw === "string" && raw.length > 0) return raw;
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

export function addKnownChat(allKnownChats, session, chatInfo) {
  const chatChannel = chatInfo.channel?.trim();
  if (!chatChannel) return;
  const ownerKey = getKnownChatsOwnerKey(session);
  if (!ownerKey) return;
  if (!Array.isArray(allKnownChats[ownerKey])) {
    allKnownChats[ownerKey] = [];
  }
  const userKnownChats = allKnownChats[ownerKey];
  const existingIndex = userKnownChats.findIndex((chat) => chat.channel === chatChannel);
  const nextChat = {
    channel: chatChannel,
    title: chatInfo.title?.trim() || "Known Chat",
    players: typeof chatInfo.players === "number" ? chatInfo.players : null,
  };
  if (existingIndex >= 0) {
    userKnownChats[existingIndex] = {
      ...userKnownChats[existingIndex],
      ...nextChat,
    };
  } else {
    userKnownChats.unshift(nextChat);
  }
  saveAllKnownChats(allKnownChats);
}

export function lookupKnownChatTitle(session, channelId) {
  if (!channelId) return null;
  const all = loadAllKnownChats();
  const list = getCurrentUserKnownChats(all, session);
  const hit = list.find((c) => c.channel === channelId);
  return hit?.title ?? null;
}

export function lookupKnownChatPlayers(session, channelId) {
  if (!channelId) return null;
  const all = loadAllKnownChats();
  const list = getCurrentUserKnownChats(all, session);
  const hit = list.find((c) => c.channel === channelId);
  return hit?.players ?? null;
}
