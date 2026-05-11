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

/** Stored on Chat Create/Update; filters what appears under Game Tools. */
export const PARTYUP_GAME_TOOL_IDS = ["dice", "catan", "botc"];

export const PARTYUP_GAME_TOOL_OPTIONS = [
  { id: "dice", label: "Roll a Die" },
  { id: "catan", label: "Catan Tracker" },
  { id: "botc", label: "BoTC Role Tracker" },
];

/** Fallback when channel/game is unknown (same as Other → dice only). */
export const PARTYUP_DEFAULT_ENABLED_GAME_TOOLS = ["dice"];

/** Valid tool ids only; may be empty if the host disabled every tool. */
export function normalizeEnabledGameTools(raw) {
  const allowed = new Set(PARTYUP_GAME_TOOL_IDS);
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const x of raw) {
    const id = String(x || "").trim().toLowerCase();
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Enabled tools from latest Update, else Create, else inferred from effective game (e.g. Other → dice only). */
export function effectiveEnabledGameTools(objects, channelId) {
  const latest = latestUpdateForChannel(objects, channelId);
  if (latest?.value != null && Array.isArray(latest.value.enabledGameTools)) {
    return normalizeEnabledGameTools(latest.value.enabledGameTools);
  }
  const create = createForChannel(objects, channelId);
  if (create?.value != null && Array.isArray(create.value.enabledGameTools)) {
    return normalizeEnabledGameTools(create.value.enabledGameTools);
  }
  const game = effectiveGame(objects, channelId);
  return [...defaultEnabledGameToolsForGame(game)];
}

/**
 * Default tool checkboxes for new chats and after changing game type in Chat Settings.
 * Host can enable any combination afterward — tools are not hidden by game type.
 */
export function defaultEnabledGameToolsForGame(game) {
  const g = String(game ?? "").trim();
  if (g === "Catan") return ["catan"];
  if (isBloodOnTheClocktowerGame(g)) return ["botc"];
  return ["dice"];
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

/** From latest Chat Update; when true, the whole Invite sidebar block is hidden from non-hosts. */
export function effectiveInviteLocked(objects, channelId) {
  const latest = latestUpdateForChannel(objects, channelId);
  return Boolean(latest?.value?.inviteLocked);
}

/** When true, users can enter a full room as read-only spectators (until they join as a player). */
export function effectiveSpectatingEnabled(objects, channelId) {
  const id = String(channelId ?? "").trim();
  if (!id) return false;
  const latest = latestUpdateForChannel(objects, id);
  const u = latest?.value?.spectatingEnabled;
  if (typeof u === "boolean") return u;
  const create = createForChannel(objects, id);
  const c = create?.value?.spectatingEnabled;
  if (typeof c === "boolean") return c;
  return false;
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
 * Latest "membership" timestamp for an actor: chat Create (owner) and partyupJoin pings only.
 * Used so a host kick (Chat Update kickTimestamps) cannot be overridden by ordinary messages — only a new join ping
 * after the kick restores presence.
 */
export function membershipBaselinePublished(createObject, messageObjects, actorId) {
  const id = String(actorId || "").trim();
  if (!id) return 0;
  let maxPub = 0;
  const creator = createObject?.actor;
  const createPub = Number(createObject?.value?.published) || 0;
  if (creator && String(creator).trim() === id && createPub > maxPub) maxPub = createPub;
  for (const m of messageObjects) {
    if (String(m.actor || "").trim() !== id) continue;
    const v = m.value || {};
    if (!v.partyupJoin) continue;
    const pub = Number(v.published) || 0;
    if (pub > maxPub) maxPub = pub;
  }
  return maxPub;
}

/**
 * Baseline for "was I in the session before this kick?" on the kicked client.
 * Join/create only is too strict (users can be present from chat without a stored partyupJoin row).
 * Presence roster kick filtering still uses {@link membershipBaselinePublished} only.
 */
export function kickSessionBaselinePublished(createObject, messageObjects, actorId) {
  const joinBaseline = membershipBaselinePublished(createObject, messageObjects, actorId);
  const id = String(actorId || "").trim();
  if (!id) return joinBaseline;
  let activityMax = 0;
  for (const m of messageObjects) {
    if (String(m.actor || "").trim() !== id) continue;
    const v = m.value || {};
    if (v.partyupLeave) continue;
    const pub = Number(v.published) || 0;
    if (pub > activityMax) activityMax = pub;
  }
  return Math.max(joinBaseline, activityMax);
}

/**
 * Actors currently "in" the room for player list + capacity.
 * Latest leave ping must be older than the latest join ping / chat message / creator create time.
 * @param {Record<string, number>|null|undefined} kickTimestampsByActor optional map from actor id → kick time (ms); actors kicked since their last join ping are excluded until they send a new partyupJoin after that kick.
 */
export function presentParticipantActorSet(createObject, messageObjects, kickTimestampsByActor) {
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

  if (kickTimestampsByActor && typeof kickTimestampsByActor === "object" && !Array.isArray(kickTimestampsByActor)) {
    for (const actor of [...out]) {
      const rawK = kickTimestampsByActor[actor];
      if (rawK == null) continue;
      const kt = Number(rawK);
      if (!Number.isFinite(kt)) continue;
      const baseline = membershipBaselinePublished(createObject, messageObjects, actor);
      if (baseline <= kt) out.delete(actor);
    }
  }

  return out;
}
