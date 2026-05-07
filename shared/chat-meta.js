/** Hard cap for max players on create, settings, and join logic. */
export const PARTYUP_MAX_PLAYERS = 100;

/**
 * See Players roster: mark someone as recently active if their latest message is newer than this.
 * There is no separate presence channel — leaving the page does not remove you from the participant set.
 */
export const PARTYUP_PLAYER_RECENT_ACTIVITY_MS = 5 * 60 * 1000;

export function clampPlayerCap(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(PARTYUP_MAX_PLAYERS, n);
}

/** Match Game Settings / Create Chat dropdown values. */
export const PARTYUP_GAME_OPTIONS = [
  { value: "D&D", label: "D&D" },
  { value: "Catan", label: "Catan" },
  { value: "BoTC", label: "Blood on the Clocktower" },
  { value: "Pathfinder", label: "Pathfinder" },
  { value: "Other", label: "Other" },
];

/** Stored chat `game` value for the BoTC preset is the key `BoTC`; accept legacy / pasted spellings. */
export function isBloodOnTheClocktowerGame(game) {
  const g = String(game ?? "").trim();
  if (!g) return false;
  if (g === "BoTC") return true;
  const norm = g.toLowerCase();
  if (norm === "blood on the clocktower" || norm === "bloodontheclocktower") return true;
  return /^blood\s+on\s+the\s+clocktower$/i.test(g.trim());
}

export function listChatCreates(objects) {
  return objects.filter((o) => o.value?.activity === "Create" && o.value?.type === "Chat");
}

export function listChatUpdates(objects) {
  return objects.filter((o) => o.value?.activity === "Update" && o.value?.type === "Chat");
}

export function createForChannel(objects, channelId) {
  const id = (channelId || "").trim();
  if (!id) return null;
  return listChatCreates(objects).find((o) => o.value.channel === id) ?? null;
}

export function latestUpdateForChannel(objects, channelId) {
  const id = (channelId || "").trim();
  if (!id) return null;
  const updates = listChatUpdates(objects)
    .filter((o) => o.value.channel === id)
    .slice()
    .sort((a, b) => (b.value.published || 0) - (a.value.published || 0));
  return updates[0] ?? null;
}

export function effectiveMaxPlayers(objects, channelId) {
  const create = createForChannel(objects, channelId);
  const latest = latestUpdateForChannel(objects, channelId);
  const fromCreate = Math.max(1, Math.floor(Number(create?.value?.players)) || 1);
  const fromUpdate = latest?.value?.players;
  if (typeof fromUpdate === "number" && Number.isFinite(fromUpdate)) {
    return clampPlayerCap(Math.max(1, Math.floor(fromUpdate)));
  }
  return clampPlayerCap(fromCreate);
}

export function effectiveGame(objects, channelId) {
  const create = createForChannel(objects, channelId);
  const latest = latestUpdateForChannel(objects, channelId);
  const fromUpdate = latest?.value?.game;
  if (fromUpdate != null && String(fromUpdate).trim()) return String(fromUpdate).trim();
  const fromCreate = create?.value?.game;
  if (fromCreate != null && String(fromCreate).trim()) return String(fromCreate).trim();
  return "Other";
}

/** Chat title from latest Update when set; otherwise from Create. */
export function effectiveChatTitle(objects, channelId) {
  const create = createForChannel(objects, channelId);
  const latest = latestUpdateForChannel(objects, channelId);
  const fromUpdate = latest?.value?.title;
  if (fromUpdate != null && String(fromUpdate).trim()) return String(fromUpdate).trim();
  const fromCreate = create?.value?.title;
  if (fromCreate != null && String(fromCreate).trim()) return String(fromCreate).trim();
  return "";
}

/** Dice types for the General Tools roller. */
export const PARTYUP_DICE_OPTIONS = [
  { sides: 4, label: "d4" },
  { sides: 6, label: "d6" },
  { sides: 8, label: "d8" },
  { sides: 12, label: "d12" },
  { sides: 20, label: "d20" },
  { sides: 100, label: "d100" },
];

/** From latest Chat Update; when true, only the host should see the invite copy control. */
export function effectiveInviteLocked(objects, channelId) {
  const latest = latestUpdateForChannel(objects, channelId);
  return Boolean(latest?.value?.inviteLocked);
}

/** Banned actor ids from latest Chat Update (cannot rejoin). */
export function effectiveBannedActors(objects, channelId) {
  const latest = latestUpdateForChannel(objects, channelId);
  const raw = latest?.value?.bannedActors;
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const a of raw) {
    const id = String(a || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Per-actor kick timestamps (ms) from latest Chat Update.
 * If a user's kick time is after when they entered the room, they are session-kicked (can rejoin).
 */
export function effectiveKickTimestamps(objects, channelId) {
  const latest = latestUpdateForChannel(objects, channelId);
  const raw = latest?.value?.kickTimestamps;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const id = String(k || "").trim();
    const ts = Number(v);
    if (!id || !Number.isFinite(ts)) continue;
    out[id] = ts;
  }
  return out;
}

/** Unique actors who have posted on channel plus chat creator (from Create object). */
export function participantActorSet(createObject, messageObjects) {
  const actors = new Set();
  if (createObject?.actor) actors.add(createObject.actor);
  for (const m of messageObjects) {
    if (m.actor) actors.add(m.actor);
  }
  return actors;
}

/** System rows posted for join/leave presence (hidden from the message timeline). */
export function isPartyupPresenceMessage(m) {
  const v = m?.value;
  return Boolean(v?.partyupLeave || v?.partyupJoin);
}

/**
 * Actors currently "in" the room for player list + capacity.
 * Latest leave ping must be older than the latest join ping / chat message / creator create time.
 */
export function presentParticipantActorSet(createObject, messageObjects) {
  const historical = participantActorSet(createObject, messageObjects);
  const leaveTs = new Map();
  const activeTs = new Map();

  const bumpActive = (actor, ts) => {
    const t = Number(ts) || 0;
    if (!actor || !t) return;
    const prev = activeTs.get(actor) ?? 0;
    if (t > prev) activeTs.set(actor, t);
  };

  const bumpLeave = (actor, ts) => {
    const t = Number(ts) || 0;
    if (!actor || !t) return;
    const prev = leaveTs.get(actor) ?? 0;
    if (t > prev) leaveTs.set(actor, t);
  };

  const creator = createObject?.actor;
  const createPub = Number(createObject?.value?.published) || 0;
  if (creator && createPub) bumpActive(creator, createPub);

  for (const m of messageObjects) {
    const actor = m.actor;
    if (!actor) continue;
    const v = m.value || {};
    const pub = Number(v.published) || 0;
    if (!pub) continue;
    if (v.partyupLeave) {
      bumpLeave(actor, pub);
      continue;
    }
    if (v.partyupJoin) {
      bumpActive(actor, pub);
      continue;
    }
    bumpActive(actor, pub);
  }

  const out = new Set();
  for (const actor of historical) {
    const l = leaveTs.get(actor) ?? 0;
    const a = activeTs.get(actor) ?? 0;
    if (a > l) out.add(actor);
  }
  return out;
}
