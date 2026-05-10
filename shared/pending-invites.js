import { getKnownChatsOwnerKey } from "./known-chats.js";

const STORAGE_KEY = "partyup-pending-invites";

export function loadAllPendingInvites() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

export function saveAllPendingInvites(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn("partyup-pending-invites: save failed", e);
  }
}

export function getPendingInvitesForUser(map, session) {
  const owner = getKnownChatsOwnerKey(session);
  if (!owner) return [];
  const arr = map[owner];
  return Array.isArray(arr) ? [...arr] : [];
}

export function addPendingInvite(map, session, channelId, options = {}) {
  const id = String(channelId ?? "").trim();
  const owner = getKnownChatsOwnerKey(session);
  if (!owner || !id) return;
  if (!Array.isArray(map[owner])) map[owner] = [];
  const list = map[owner];
  const titleFromInvite = String(options.chatTitle ?? options.inviteTitle ?? "").trim();
  const idx = list.findIndex((x) => x.channel === id);
  if (idx >= 0) {
    if (titleFromInvite) {
      list[idx] = { ...list[idx], inviteTitle: titleFromInvite };
      saveAllPendingInvites(map);
    }
    return;
  }
  const row = { channel: id, invitedAt: Date.now() };
  if (titleFromInvite) row.inviteTitle = titleFromInvite;
  list.unshift(row);
  saveAllPendingInvites(map);
}

export function removePendingInvite(map, session, channelId) {
  const id = String(channelId ?? "").trim();
  const owner = getKnownChatsOwnerKey(session);
  if (!owner || !id || !Array.isArray(map[owner])) return;
  map[owner] = map[owner].filter((x) => x.channel !== id);
  if (map[owner].length === 0) delete map[owner];
  saveAllPendingInvites(map);
}

/** Channels the user declined from the Lobby; blocks auto re-add from Graffiti invite objects. */
const DISMISSED_PUSH_KEY = "partyup-invite-push-dismissed";

export function loadDismissedPushInviteChannels() {
  try {
    const raw = localStorage.getItem(DISMISSED_PUSH_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

export function saveDismissedPushInviteChannels(map) {
  try {
    localStorage.setItem(DISMISSED_PUSH_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn("partyup-invite-push-dismissed: save failed", e);
  }
}

export function dismissPushInviteChannel(map, session, channelId) {
  const id = String(channelId ?? "").trim();
  const owner = getKnownChatsOwnerKey(session);
  if (!owner || !id) return;
  if (!map[owner] || typeof map[owner] !== "object") map[owner] = {};
  map[owner][id] = Date.now();
  saveDismissedPushInviteChannels(map);
}

export function clearDismissedPushInviteChannel(map, session, channelId) {
  const id = String(channelId ?? "").trim();
  const owner = getKnownChatsOwnerKey(session);
  if (!owner || !id || !map[owner] || typeof map[owner] !== "object") return;
  delete map[owner][id];
  if (Object.keys(map[owner]).length === 0) delete map[owner];
  saveDismissedPushInviteChannels(map);
}

export function isPushInviteChannelDismissed(map, session, channelId) {
  const id = String(channelId ?? "").trim();
  const owner = getKnownChatsOwnerKey(session);
  if (!owner || !id || !map[owner] || typeof map[owner] !== "object") return false;
  return Object.prototype.hasOwnProperty.call(map[owner], id);
}
