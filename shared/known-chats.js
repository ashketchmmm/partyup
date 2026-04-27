const KNOWN_CHATS_STORAGE_KEY = "partyup-known-chats";

export function loadAllKnownChats() {
  try {
    const storedChats = localStorage.getItem(KNOWN_CHATS_STORAGE_KEY);
    if (!storedChats) return {};
    const parsedChats = JSON.parse(storedChats);
    return parsedChats && typeof parsedChats === "object" ? parsedChats : {};
  } catch {
    return {};
  }
}

export function saveAllKnownChats(allKnownChats) {
  localStorage.setItem(KNOWN_CHATS_STORAGE_KEY, JSON.stringify(allKnownChats));
}

export function getKnownChatsOwnerKey(session) {
  return session?.actor || "anonymous";
}

export function getCurrentUserKnownChats(allKnownChats, session) {
  const ownerKey = getKnownChatsOwnerKey(session);
  const knownChatsForUser = allKnownChats[ownerKey];
  if (Array.isArray(knownChatsForUser)) return knownChatsForUser;
  allKnownChats[ownerKey] = [];
  return allKnownChats[ownerKey];
}

export function addKnownChat(allKnownChats, session, chatInfo) {
  const chatChannel = chatInfo.channel?.trim();
  if (!chatChannel) return;
  const userKnownChats = getCurrentUserKnownChats(allKnownChats, session);
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
