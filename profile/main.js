import { ref, computed, watch } from "vue";
import { useGraffitiSession } from "@graffiti-garden/wrapper-vue";
import { getMainProfile, saveMainProfile } from "../shared/main-profile.js";
import {
  loadColorTheme,
  saveColorTheme,
  applyColorTheme,
  resetColorThemeToDefaults,
} from "../shared/color-theme.js";
import { UserAvatar } from "../components/user-avatar.js";

function setup() {
  const session = useGraffitiSession();
  const displayName = ref("");
  const avatarUrl = ref("");
  const savedHint = ref("");

  const pageBg = ref("#b9b9e0");
  const headerBg = ref("#090824");
  const accent = ref("#d5e6ff");
  const paletteSavedHint = ref("");

  function loadForm() {
    const p = getMainProfile(session.value);
    displayName.value = p.name;
    avatarUrl.value = p.avatar;
  }

  function loadPaletteForm() {
    const t = loadColorTheme();
    pageBg.value = t.pageBg;
    headerBg.value = t.headerBg;
    accent.value = t.accent;
  }

  watch(
    () => session.value?.actor,
    () => {
      savedHint.value = "";
      paletteSavedHint.value = "";
      loadForm();
      loadPaletteForm();
    },
    { immediate: true },
  );

  const canSave = computed(() => Boolean(session.value));

  function saveProfile() {
    if (!session.value) return;
    const name = displayName.value.trim() || "Me";
    const avatar = avatarUrl.value.trim();
    saveMainProfile(session.value, { name, avatar });
    displayName.value = name;
    avatarUrl.value = avatar;
    savedHint.value = "Saved.";
    window.setTimeout(() => {
      if (savedHint.value === "Saved.") savedHint.value = "";
    }, 2500);
  }

  function previewColorPalette() {
    applyColorTheme({
      pageBg: pageBg.value,
      headerBg: headerBg.value,
      accent: accent.value,
    });
  }

  function saveColorPalette() {
    if (!session.value) return;
    saveColorTheme({
      pageBg: pageBg.value,
      headerBg: headerBg.value,
      accent: accent.value,
    });
    applyColorTheme(loadColorTheme());
    paletteSavedHint.value = "Saved.";
    window.setTimeout(() => {
      if (paletteSavedHint.value === "Saved.") paletteSavedHint.value = "";
    }, 2500);
  }

  function resetColorPalette() {
    const t = resetColorThemeToDefaults();
    pageBg.value = t.pageBg;
    headerBg.value = t.headerBg;
    accent.value = t.accent;
    paletteSavedHint.value = "Reset to defaults.";
    window.setTimeout(() => {
      if (paletteSavedHint.value === "Reset to defaults.") paletteSavedHint.value = "";
    }, 2500);
  }

  return {
    displayName,
    avatarUrl,
    canSave,
    saveProfile,
    savedHint,
    pageBg,
    headerBg,
    accent,
    paletteSavedHint,
    previewColorPalette,
    saveColorPalette,
    resetColorPalette,
  };
}

export default async () => ({
  components: { UserAvatar },
  setup,
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
