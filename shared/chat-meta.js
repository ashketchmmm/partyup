/** Match Game Settings / Create Chat dropdown values. */
export const PARTYUP_GAME_OPTIONS = [
  { value: "D&D", label: "D&D" },
  { value: "Catan", label: "Catan" },
  { value: "BoTC", label: "Blood on the Clocktower" },
  { value: "Pathfinder", label: "Pathfinder" },
  { value: "Other", label: "Other" },
];

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
    return Math.max(1, Math.floor(fromUpdate));
  }
  return fromCreate;
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

/** Unique actors who have posted on channel plus chat creator (from Create object). */
export function participantActorSet(createObject, messageObjects) {
  const actors = new Set();
  if (createObject?.actor) actors.add(createObject.actor);
  for (const m of messageObjects) {
    if (m.actor) actors.add(m.actor);
  }
  return actors;
}
