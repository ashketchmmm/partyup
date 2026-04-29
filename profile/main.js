import { ref, computed, watch } from "vue";
import { useGraffitiSession } from "@graffiti-garden/wrapper-vue";
import { getMainProfile, saveMainProfile } from "../shared/main-profile.js";

function setup() {
  const session = useGraffitiSession();
  const displayName = ref("");
  const avatarUrl = ref("");
  const savedHint = ref("");

  function loadForm() {
    const p = getMainProfile(session.value);
    displayName.value = p.name;
    avatarUrl.value = p.avatar;
  }

  watch(
    () => session.value?.actor,
    () => {
      savedHint.value = "";
      loadForm();
    },
    { immediate: true },
  );

  const initials = computed(() => {
    const n = displayName.value.trim() || "Me";
    return n.slice(0, 2).toUpperCase();
  });

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

  return {
    displayName,
    avatarUrl,
    initials,
    canSave,
    saveProfile,
    savedHint,
  };
}

export default async () => ({
  setup,
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
