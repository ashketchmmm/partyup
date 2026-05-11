const MAIN_PROFILE_STORAGE_KEY = "partyup-main-profile";

function ownerKey(session) {
  return session?.actor || "anonymous";
}

/**
 * Display short name when `actor` is already a Graffiti handle (`ash.graffiti.actor` → `ash`).
 * Returns "" if not that shape (opaque ids need {@link Graffiti.actorToHandle}).
 */
export function shortNameFromGraffitiActor(actor) {
  const s = String(actor ?? "").trim();
  if (!s) return "";
  const suf = ".graffiti.actor";
  if (s.toLowerCase().endsWith(suf)) {
    const base = s.slice(0, -suf.length);
    return base.trim() || "";
  }
  return "";
}

export function hasSavedMainProfileName(session) {
  const row = loadAllMainProfiles()[ownerKey(session)];
  return Boolean(row?.name != null && String(row.name).trim());
}

export function loadAllMainProfiles() {
  try {
    const raw = localStorage.getItem(MAIN_PROFILE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getMainProfile(session) {
  const row = loadAllMainProfiles()[ownerKey(session)];
  const stored = row?.name != null ? String(row.name).trim() : "";
  const fromActor = session?.actor ? shortNameFromGraffitiActor(session.actor) : "";
  return {
    name: stored || fromActor || "Me",
    avatar: (row?.avatar && String(row.avatar).trim()) || "",
  };
}

export function saveMainProfile(session, { name, avatar }) {
  const all = loadAllMainProfiles();
  all[ownerKey(session)] = {
    name: name?.trim() || "Name",
    avatar: avatar?.trim() || "",
    updated: Date.now(),
  };
  localStorage.setItem(MAIN_PROFILE_STORAGE_KEY, JSON.stringify(all));
}
