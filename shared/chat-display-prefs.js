import { ref, watch } from "vue";

const STORAGE_KEY = "partyup-chat-display-prefs";

function defaults() {
  return {
    /** Sidebar / mobile bar game title */
    showGame: true,
    /** Max player cap in sidebar */
    showMaxPlayers: true,
    /** "Players Online" segment in the app header title */
    showPlayersOnline: true,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const p = JSON.parse(raw);
    return { ...defaults(), ...p };
  } catch {
    return defaults();
  }
}

/** Per-browser display toggles for chat info (sidebar + header). */
export const chatDisplayPrefs = ref(load());

watch(
  chatDisplayPrefs,
  (v) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    } catch {
      /* ignore quota */
    }
  },
  { deep: true },
);
