const MAIN_PROFILE_STORAGE_KEY = "partyup-main-profile";

function ownerKey(session) {
  return session?.actor || "anonymous";
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
  return {
    name: (row?.name && String(row.name).trim()) || "Me",
    avatar: (row?.avatar && String(row.avatar).trim()) || "",
  };
}

export function saveMainProfile(session, { name, avatar }) {
  const all = loadAllMainProfiles();
  all[ownerKey(session)] = {
    name: name?.trim() || "Me",
    avatar: avatar?.trim() || "",
    updated: Date.now(),
  };
  localStorage.setItem(MAIN_PROFILE_STORAGE_KEY, JSON.stringify(all));
}
