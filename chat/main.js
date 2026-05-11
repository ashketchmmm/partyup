import { ref, computed, watch, toRef, onMounted, onUnmounted, nextTick } from "vue";
import { useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import {
  lookupKnownChatTitle,
  lookupKnownChatPlayers,
  lookupKnownChatSpectator,
  addKnownChat,
  loadAllKnownChats,
  removeKnownChat,
  defaultKnownChatTitle,
} from "../shared/known-chats.js";
import {
  PARTYUP_GAME_OPTIONS,
  PARTYUP_MAX_PLAYERS,
  PARTYUP_PLAYER_RECENT_ACTIVITY_MS,
  clampPlayerCap,
  createForChannel,
  effectiveMaxPlayers,
  effectiveGame,
  effectiveChatTitle,
  PARTYUP_DICE_OPTIONS,
  isBloodOnTheClocktowerGame,
  effectiveInviteLocked,
  effectiveSpectatingEnabled,
  effectiveBannedActors as bannedActorsForChannel,
  effectiveKickTimestamps,
  effectiveEnabledGameTools,
  normalizeEnabledGameTools,
  defaultEnabledGameToolsForGame,
  PARTYUP_GAME_TOOL_OPTIONS,
  PARTYUP_DEFAULT_ENABLED_GAME_TOOLS,
  listChatUpdates,
  presentParticipantActorSet,
  isPartyupPresenceMessage,
} from "../shared/chat-meta.js";
import { getMainProfile } from "../shared/main-profile.js";
import { headerChatLivePlayers } from "../shared/header-chat-live.js";
import { PARTYUP_SCROLL_CHAT_TOP_EVENT } from "../shared/chat-ui-events.js";
import { buildPartyupInviteLink } from "../shared/chat-invite.js";
import { recordCoplayActors, getCoplayActorsForSidebar } from "../shared/coplay.js";
import {
  normalizeInviteToActorId,
  normalizePartyupActorHandle,
  sessionActorIdForInvites,
} from "../shared/partyup-invite-push.js";
import { loadScrollRatio, saveScrollRatio } from "../shared/chat-scroll-state.js";
import { chatDisplayPrefs } from "../shared/chat-display-prefs.js";
import { resolveRulebookUrl } from "../shared/game-rulebooks.js";
import { PARTYUP_BOTC_ROLES, partyupBotcTeamLabel } from "../shared/botc-roles.js";
import { UserAvatar } from "../components/user-avatar.js";

const profilesStorageKey = "partyup-chat-profiles";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function localDayKey(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ordinalSuffix(n) {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

/** Calendar-day label for chat separators (viewer's local timezone). */
function formatChatDaySeparatorLabel(ms, nowMs = Date.now()) {
  const d = new Date(ms);
  const now = new Date(nowMs);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startToday - startMsg) / 86400000);
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  const month = MONTH_NAMES[d.getMonth()];
  const dom = d.getDate();
  const ord = ordinalSuffix(dom);
  const label = `${month} ${dom}${ord}`;
  if (d.getFullYear() === now.getFullYear()) return label;
  return `${label}, ${d.getFullYear()}`;
}

/** Scroll offsets of day separator rows relative to the message list scroll container. */
function getDaySeparatorOffsets(listEl) {
  if (!listEl) return [];
  const listRect = listEl.getBoundingClientRect();
  const nodes = listEl.querySelectorAll("li.message-day-separator-wrap");
  const tops = [];
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    tops.push(r.top - listRect.top + listEl.scrollTop);
  }
  tops.sort((a, b) => a - b);
  return tops;
}

function parseChatSearchQuery(raw) {
  const mentionNames = [];
  const re = /@\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1].trim();
    if (name) mentionNames.push(name);
  }
  let keywordsText = raw.replace(re, " ");
  keywordsText = keywordsText.replace(/\s+/g, " ").trim();
  const keywords = keywordsText ? keywordsText.split(/\s+/).filter(Boolean) : [];
  return { mentionNames, keywords };
}

function resolveMentionNameToActor(name, nameToActor, actorDirMap) {
  const key = name.trim().toLowerCase();
  const direct = nameToActor.get(key);
  if (direct) return direct;
  for (const [actorId, meta] of actorDirMap) {
    if ((meta.name || "").trim().toLowerCase() === key) return actorId;
  }
  return null;
}

function messageMatchesChatSearch(messageObject, parsed, nameToActor, actorDirMap) {
  const content = (messageObject.value.content || "").toLowerCase();
  const actor = messageObject.actor;
  const profileName = (messageObject.value.profileName || "").trim().toLowerCase();

  if (parsed.mentionNames.length > 0) {
    let matchedMention = false;
    for (const mn of parsed.mentionNames) {
      const resolved = resolveMentionNameToActor(mn, nameToActor, actorDirMap);
      if (resolved && resolved === actor) {
        matchedMention = true;
        break;
      }
      if (profileName === mn.trim().toLowerCase()) {
        matchedMention = true;
        break;
      }
    }
    if (!matchedMention) return false;
  }

  for (const kw of parsed.keywords) {
    if (!content.includes(kw.toLowerCase())) return false;
  }
  return true;
}

function chatSearchAtWordBoundary(text, atIndex) {
  if (atIndex <= 0) return true;
  return /\s/.test(text.charAt(atIndex - 1));
}

/** Cursor inside an incomplete @[…] or bare @ mention for autocomplete. */
function getActiveChatSearchMention(query, cursorPos) {
  const before = query.slice(0, cursorPos);
  const idxBracket = before.lastIndexOf("@[");
  if (idxBracket !== -1 && chatSearchAtWordBoundary(before, idxBracket)) {
    const after = before.slice(idxBracket + 2);
    if (!after.includes("]")) {
      return { replaceStart: idxBracket, replaceEnd: cursorPos, prefix: after };
    }
  }
  const idxAt = before.lastIndexOf("@");
  if (idxAt === -1 || !chatSearchAtWordBoundary(before, idxAt)) return null;
  const tail = before.slice(idxAt);
  if (tail === "@") {
    return { replaceStart: idxAt, replaceEnd: cursorPos, prefix: "" };
  }
  if (tail.startsWith("@") && !tail.includes("[") && tail.length > 1) {
    return { replaceStart: idxAt, replaceEnd: cursorPos, prefix: tail.slice(1) };
  }
  return null;
}

const REPLY_PREVIEW_MAX = 180;

function truncateReplyPreview(s, maxLen = REPLY_PREVIEW_MAX) {
  const t = String(s || "").trim().replace(/\s+/g, " ");
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

/** When replying to a PM, who receives our outgoing message. */
function replyPrivateRecipient(parentMsg, sessionActor) {
  const v = parentMsg?.value;
  if (!v?.privateToActor) return null;
  if (parentMsg.actor === sessionActor) {
    return {
      actor: v.privateToActor,
      nickname: (v.privateToNickname || "").trim() || "User",
    };
  }
  return {
    actor: parentMsg.actor,
    nickname: (v.profileName || "").trim() || "User",
  };
}

function chatSetup(props) {
  const router = useRouter();
  const graffiti = useGraffiti();
  const session = useGraffitiSession();
  const chatIdRef = toRef(props, "chatId");

  const showGameOverlay = ref(false);
  const showChatOverlay = ref(false);
  const showToolOverlay = ref(false);
  const showRulebookViewer = ref(false);
  const rulebookViewerUrl = ref("");
  const rulebookMissingGame = ref("");
  const showPlayersDropdown = ref(false);
  /** Cleared when switching chats or leaving; avoids duplicate join pings per channel. */
  const joinPingPostedForChannel = ref(null);
  const catanCountRoads = ref(0);
  const catanCountSettlements = ref(0);
  const catanCountCities = ref(0);
  const catanCountVP = ref(0);
  const selectedBotcRoleId = ref("");
  const allUserProfiles = ref(loadAllUserProfiles());
  const showProfileMenu = ref(false);
  const newProfileName = ref("");
  const newProfileAvatar = ref("");
  const privateMessageTarget = ref(null);
  const replyDraftTarget = ref(null);
  const sendError = ref("");
  const suppressKnownChatPersist = ref(false);
  const deleteChatError = ref("");
  const showDeleteChatConfirm = ref(false);
  const forgetChatError = ref("");
  const isDeletingChat = ref(false);
  /** Cleared on unmount; used when scrolling after sending a message. */
  let scrollAfterSendFallbackTimer = null;
  let scrollSaveTimer = null;

  const channel = computed(() => (chatIdRef.value || "").trim());

  const CHAT_LAYOUT_NARROW_MQ = "(max-width: 900px)";
  const chatLayoutNarrow = ref(false);
  const chatSettingsExpanded = ref(false);

  function syncChatLayoutNarrow() {
    chatLayoutNarrow.value =
      typeof window !== "undefined" && window.matchMedia(CHAT_LAYOUT_NARROW_MQ).matches;
  }

  let chatLayoutMql = null;

  syncChatLayoutNarrow();

  watch(
    chatLayoutNarrow,
    (narrow) => {
      chatSettingsExpanded.value = !narrow;
    },
    { immediate: true },
  );

  function loadAllUserProfiles() {
    try {
      const storedProfiles = localStorage.getItem(profilesStorageKey);
      if (!storedProfiles) return {};
      const parsedProfiles = JSON.parse(storedProfiles);
      return parsedProfiles && typeof parsedProfiles === "object" ? parsedProfiles : {};
    } catch {
      return {};
    }
  }

  function saveAllUserProfiles() {
    localStorage.setItem(profilesStorageKey, JSON.stringify(allUserProfiles.value));
  }

  function getProfileOwnerKey() {
    return session.value?.actor || "anonymous";
  }

  function getCurrentUserProfilesByChat() {
    const ownerKey = getProfileOwnerKey();
    const userProfiles = allUserProfiles.value[ownerKey];
    if (userProfiles && typeof userProfiles === "object") return userProfiles;
    allUserProfiles.value[ownerKey] = {};
    return allUserProfiles.value[ownerKey];
  }

  function createDefaultProfile() {
    const main = getMainProfile(session.value);
    return {
      id: crypto.randomUUID(),
      name: main.name || "Me",
      avatar: main.avatar || "",
    };
  }

  function ensureChatProfiles(channelId) {
    if (!channelId) return;
    const currentUserProfiles = getCurrentUserProfilesByChat();
    const existingState = currentUserProfiles[channelId];
    if (existingState?.profiles?.length) {
      if (
        !existingState.selectedProfileId ||
        !existingState.profiles.some((profile) => profile.id === existingState.selectedProfileId)
      ) {
        existingState.selectedProfileId = existingState.profiles[0].id;
        saveAllUserProfiles();
      }
      return;
    }

    const defaultProfile = createDefaultProfile();
    currentUserProfiles[channelId] = {
      profiles: [defaultProfile],
      selectedProfileId: defaultProfile.id,
    };
    saveAllUserProfiles();
  }

  watch(
    channel,
    (id) => {
      suppressKnownChatPersist.value = false;
      joinPingPostedForChannel.value = null;
      catanCountRoads.value = 0;
      catanCountSettlements.value = 0;
      catanCountCities.value = 0;
      catanCountVP.value = 0;
      selectedBotcRoleId.value = "";
      replyDraftTarget.value = null;
      if (id) ensureChatProfiles(id);
    },
    { immediate: true },
  );

  const currentProfileState = computed(() => {
    if (!channel.value) return null;
    ensureChatProfiles(channel.value);
    const currentUserProfiles = getCurrentUserProfilesByChat();
    return currentUserProfiles[channel.value] ?? null;
  });

  const currentProfiles = computed(() => currentProfileState.value?.profiles ?? []);

  const activeProfile = computed(() => {
    const profileState = currentProfileState.value;
    if (!profileState) return null;
    return (
      profileState.profiles.find((profile) => profile.id === profileState.selectedProfileId) ??
      profileState.profiles[0] ??
      null
    );
  });

  /** When set, the bottom form edits this profile; when null, the form adds a new profile. */
  const editingProfileId = ref(null);

  /** Load a profile into the shared name/avatar fields (used for add + edit). */
  function beginEditProfile(profileId) {
    const profileState = currentProfileState.value;
    if (!profileState) return;
    const p = profileState.profiles.find((profile) => profile.id === profileId);
    if (!p) return;
    profileState.selectedProfileId = profileId;
    editingProfileId.value = profileId;
    newProfileName.value = p.name;
    newProfileAvatar.value = p.avatar || "";
    saveAllUserProfiles();
  }

  function cancelProfileDraft() {
    editingProfileId.value = null;
    newProfileName.value = "";
    newProfileAvatar.value = "";
  }

  function submitProfileForm() {
    const profileState = currentProfileState.value;
    if (!profileState) return;
    const trimmedName = newProfileName.value.trim();
    if (!trimmedName) return;
    const avatar = newProfileAvatar.value.trim();
    if (editingProfileId.value) {
      const p = profileState.profiles.find((pr) => pr.id === editingProfileId.value);
      if (!p) return;
      p.name = trimmedName;
      p.avatar = avatar;
      profileState.selectedProfileId = p.id;
    } else {
      const newProfile = {
        id: crypto.randomUUID(),
        name: trimmedName,
        avatar,
      };
      profileState.profiles.unshift(newProfile);
      profileState.selectedProfileId = newProfile.id;
    }
    cancelProfileDraft();
    saveAllUserProfiles();
    showProfileMenu.value = false;
  }

  function removeProfile(profileId) {
    const profileState = currentProfileState.value;
    if (!profileState || profileState.profiles.length <= 1) return;
    if (editingProfileId.value === profileId) cancelProfileDraft();
    profileState.profiles = profileState.profiles.filter((profile) => profile.id !== profileId);
    if (!profileState.profiles.some((profile) => profile.id === profileState.selectedProfileId)) {
      profileState.selectedProfileId = profileState.profiles[0]?.id ?? null;
    }
    saveAllUserProfiles();
  }

  function toggleProfileMenu() {
    const nextOpen = !showProfileMenu.value;
    showProfileMenu.value = nextOpen;
    if (!nextOpen) cancelProfileDraft();
  }

  const partyupChatSchema = {
    properties: {
      value: {
        required: ["activity", "type", "channel", "published"],
        properties: {
          activity: { enum: ["Create", "Update"] },
          type: { const: "Chat" },
          channel: { type: "string" },
          title: { type: "string" },
          players: { type: "number" },
          game: { type: "string" },
          private: { type: "boolean" },
          published: { type: "number" },
          inviteLocked: { type: "boolean" },
          spectatingEnabled: { type: "boolean" },
          enabledGameTools: { type: "array", items: { type: "string" } },
          bannedActors: { type: "array", items: { type: "string" } },
          kickTimestamps: { type: "object" },
        },
      },
    },
  };

  const { objects: chats } = useGraffitiDiscover(
    () => (session.value ? ["partyup-26"] : []),
    partyupChatSchema,
  );

  const currentChat = computed(() => createForChannel(chats.value, channel.value));

  const currentChatName = computed(() => {
    const fromObjects =
      channel.value && chats.value.length
        ? effectiveChatTitle(chats.value, channel.value)
        : "";
    return (
      fromObjects ||
      lookupKnownChatTitle(session.value, channel.value) ||
      defaultKnownChatTitle(channel.value)
    );
  });

  const maxPlayersEffective = computed(() =>
    channel.value ? effectiveMaxPlayers(chats.value, channel.value) : 1,
  );

  /**
   * Touch Update + Create `game` fields so computed Game Help tracks Graffiti discover edits
   * (nested mutations don’t always invalidate shallow dependents).
   */
  const chatGameReactiveFingerprint = computed(() => {
    const ch = channel.value;
    if (!ch) return "";
    const create = createForChannel(chats.value, ch);
    const parts = [`c:${String(create?.value?.game ?? "")}`];
    for (const o of listChatUpdates(chats.value)) {
      if (o.value?.channel !== ch) continue;
      parts.push(`u:${String(o.value?.published ?? "")}:${String(o.value?.game ?? "")}`);
    }
    return parts.join("|");
  });

  const currentChatGame = computed(() => {
    void chatGameReactiveFingerprint.value;
    return channel.value ? effectiveGame(chats.value, channel.value) : "Other";
  });

  const enabledGameToolsEffective = computed(() =>
    channel.value ? effectiveEnabledGameTools(chats.value, channel.value) : PARTYUP_DEFAULT_ENABLED_GAME_TOOLS,
  );

  const enabledGameToolsSet = computed(() => new Set(enabledGameToolsEffective.value));

  /** Shown when the host enabled the tool — not gated by chat game type. */
  const showToolDice = computed(() => enabledGameToolsSet.value.has("dice"));
  const showToolCatan = computed(() => enabledGameToolsSet.value.has("catan"));
  const showToolBotc = computed(() => enabledGameToolsSet.value.has("botc"));

  const hasAnyGameTool = computed(() => showToolDice.value || showToolCatan.value || showToolBotc.value);

  const botcRolesForSelect = computed(() =>
    [...PARTYUP_BOTC_ROLES]
      .slice()
      .sort((a, b) =>
        String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }),
      ),
  );

  const selectedBotcRoleDetail = computed(() => {
    const id = selectedBotcRoleId.value;
    if (!id) return null;
    const r = PARTYUP_BOTC_ROLES.find((x) => x.id === id);
    if (!r) return null;
    return { ...r, teamLabel: partyupBotcTeamLabel(r.team) };
  });

  function adjustCatan(key, delta) {
    const map = {
      roads: catanCountRoads,
      settlements: catanCountSettlements,
      cities: catanCountCities,
      vp: catanCountVP,
    };
    const r = map[key];
    if (!r) return;
    r.value = Math.max(0, r.value + delta);
  }

  const currentChatPlayers = computed(() => maxPlayersEffective.value);

  const inviteLockedEffective = computed(() =>
    channel.value ? effectiveInviteLocked(chats.value, channel.value) : false,
  );

  const spectatingEnabledEffective = computed(() =>
    channel.value ? effectiveSpectatingEnabled(chats.value, channel.value) : false,
  );

  const bannedActorsEffective = computed(() =>
    channel.value ? bannedActorsForChannel(chats.value, channel.value) : [],
  );

  const kickTimestampsEffective = computed(() =>
    channel.value ? effectiveKickTimestamps(chats.value, channel.value) : {},
  );

  function persistKnownChatForCurrentChannel() {
    if (suppressKnownChatPersist.value) return;
    const ch = channel.value;
    const ses = session.value;
    if (!ch || !ses?.actor) return;
    const all = loadAllKnownChats();
    addKnownChat(all, ses, {
      channel: ch,
      title:
        effectiveChatTitle(chats.value, ch) ||
        lookupKnownChatTitle(ses, ch) ||
        defaultKnownChatTitle(ch),
      players: lookupKnownChatPlayers(ses, ch),
      game: effectiveGame(chats.value, ch),
    });
  }

  // Remember any chat the user opens (URL, bookmark, deep link), not only lobby flows.
  watch(
    () => [channel.value, session.value?.actor],
    () => {
      persistKnownChatForCurrentChannel();
    },
    { immediate: true },
  );

  // When Graffiti discovers the Create object, refresh stored title/players (watch url, not a new object each tick).
  watch(
    () => currentChat.value?.url,
    (url) => {
      if (suppressKnownChatPersist.value) return;
      if (!url || !channel.value || !session.value?.actor) return;
      const v = currentChat.value?.value;
      if (!v || v.channel !== channel.value) return;
      const all = loadAllKnownChats();
      addKnownChat(all, session.value, {
        channel: channel.value,
        title:
          effectiveChatTitle(chats.value, channel.value) ||
          String(v.title || "").trim() ||
          defaultKnownChatTitle(channel.value),
        players: typeof v.players === "number" ? v.players : null,
        game: v.game,
      });
    },
  );

  async function leaveChat() {
    try {
      const actor = session.value?.actor;
      const ch = channel.value;
      // Forget / delete already removed the row from Joined Chats; do not re-add a bare "Known Chat" entry.
      if (actor && ch && !suppressKnownChatPersist.value) {
        const all = loadAllKnownChats();
        addKnownChat(all, session.value, {
          channel: ch,
          spectator: false,
          title:
            effectiveChatTitle(chats.value, ch) ||
            lookupKnownChatTitle(session.value, ch) ||
            String(currentChat.value?.value?.title || "").trim() ||
            defaultKnownChatTitle(ch),
          players: lookupKnownChatPlayers(session.value, ch),
          game: effectiveGame(chats.value, ch),
        });
      }
      if (actor && ch && participantActors.value.has(actor)) {
        await postPartyupLeavePing();
      }
    } catch (e) {
      console.error(e);
    }
    persistMessageListScroll();
    if (typeof window !== "undefined" && scrollSaveTimer !== null) {
      window.clearTimeout(scrollSaveTimer);
      scrollSaveTimer = null;
    }
    myMessage.value = "";
    privateMessageTarget.value = null;
    replyDraftTarget.value = null;
    showGameOverlay.value = false;
    showChatOverlay.value = false;
    showToolOverlay.value = false;
    showRulebookViewer.value = false;
    rulebookViewerUrl.value = "";
    rulebookMissingGame.value = "";
    showPlayersDropdown.value = false;
    showProfileMenu.value = false;
    cancelProfileDraft();
    joinPingPostedForChannel.value = null;
    router.push({ name: "home" });
  }

  function removeProfilesForChannel(channelId) {
    if (!channelId) return;
    const ownerKey = getProfileOwnerKey();
    const userProfiles = allUserProfiles.value[ownerKey];
    if (userProfiles && Object.prototype.hasOwnProperty.call(userProfiles, channelId)) {
      delete userProfiles[channelId];
      saveAllUserProfiles();
    }
  }

  function forgetChatPermanently() {
    if (!session.value?.actor || !channel.value) return;
    forgetChatError.value = "";
    if (
      !confirm(
        "Remove this chat from your Joined Chats? You can open it again from Public Chats, or with an invite link.",
      )
    ) {
      return;
    }
    try {
      const ch = channel.value;
      suppressKnownChatPersist.value = true;
      removeKnownChat(loadAllKnownChats(), session.value, ch);
      removeProfilesForChannel(ch);
      if (headerChatLivePlayers.value?.channel === ch) {
        headerChatLivePlayers.value = null;
      }
      leaveChat();
    } catch (e) {
      console.error(e);
      forgetChatError.value = e?.message || "Could not update saved chats.";
      suppressKnownChatPersist.value = false;
    }
  }

  function openDeleteChatConfirm() {
    if (!session.value?.actor || !channel.value || !isChatCreator.value) return;
    if (!currentChat.value) {
      deleteChatError.value = "Chat data is still loading. Try again in a moment.";
      return;
    }
    deleteChatError.value = "";
    showDeleteChatConfirm.value = true;
  }

  function cancelDeleteChatConfirm() {
    if (isDeletingChat.value) return;
    showDeleteChatConfirm.value = false;
  }

  async function confirmDeleteChatAsOwner() {
    if (!session.value?.actor || !channel.value || !isChatCreator.value) return;
    const createObj = currentChat.value;
    if (!createObj) {
      deleteChatError.value = "Chat data is still loading. Try again in a moment.";
      showDeleteChatConfirm.value = false;
      return;
    }
    deleteChatError.value = "";
    isDeletingChat.value = true;
    try {
      const ch = channel.value;
      const actor = session.value.actor;
      const updates = listChatUpdates(chats.value).filter(
        (o) => o.value?.channel === ch && o.actor === actor,
      );
      for (const u of updates) {
        await graffiti.delete(u, session.value);
      }
      await graffiti.delete(createObj, session.value);
      suppressKnownChatPersist.value = true;
      removeKnownChat(loadAllKnownChats(), session.value, ch);
      removeProfilesForChannel(ch);
      if (headerChatLivePlayers.value?.channel === ch) {
        headerChatLivePlayers.value = null;
      }
      showDeleteChatConfirm.value = false;
      closeOverlays();
      leaveChat();
    } catch (e) {
      console.error(e);
      deleteChatError.value = e?.message || "Could not delete this chat.";
    } finally {
      isDeletingChat.value = false;
    }
  }

  const settingsChatTitle = ref("");
  const settingsGame = ref(PARTYUP_GAME_OPTIONS[0].value);
  const settingsOtherGameDetail = ref("");
  const settingsMaxPlayers = ref(1);
  const settingsInviteLocked = ref(false);
  const settingsSpectatingEnabled = ref(false);
  const settingsEnabledGameTools = ref([...PARTYUP_DEFAULT_ENABLED_GAME_TOOLS]);
  const settingsSaveError = ref("");
  const showGameChangeWarning = ref(false);
  const pendingGameChoice = ref(null);
  const moderationBusyActor = ref(null);
  const moderationBusyKind = ref(null);
  const moderationError = ref("");

  function openGameOverlay() {
    if (!isChatCreator.value) return;
    settingsSaveError.value = "";
    settingsChatTitle.value =
      (channel.value ? effectiveChatTitle(chats.value, channel.value) : "") ||
      String(currentChat.value?.value?.title || "").trim() ||
      defaultKnownChatTitle(channel.value);
    const allowedGames = new Set(PARTYUP_GAME_OPTIONS.map((o) => o.value));
    const g = currentChatGame.value;
    if (allowedGames.has(g)) {
      settingsGame.value = g;
      settingsOtherGameDetail.value = "";
    } else {
      settingsGame.value = "Other";
      settingsOtherGameDetail.value = g;
    }
    settingsMaxPlayers.value = maxPlayersEffective.value;
    settingsInviteLocked.value = inviteLockedEffective.value;
    settingsSpectatingEnabled.value = spectatingEnabledEffective.value;
    settingsEnabledGameTools.value = [...effectiveEnabledGameTools(chats.value, channel.value)];
    pendingGameChoice.value = null;
    showGameChangeWarning.value = false;
    showGameOverlay.value = true;
  }

  function onSettingsGameSelection(event) {
    const nextGame = String(event?.target?.value || "");
    if (!nextGame || nextGame === settingsGame.value) return;
    pendingGameChoice.value = nextGame;
    showGameChangeWarning.value = true;
    if (event?.target) event.target.value = settingsGame.value;
  }

  async function confirmGameSelectionChange() {
    if (pendingGameChoice.value) {
      settingsGame.value = pendingGameChoice.value;
      if (settingsGame.value !== "Other") settingsOtherGameDetail.value = "";
      const resolvedGame =
        settingsGame.value === "Other"
          ? settingsOtherGameDetail.value.trim() || "Other"
          : settingsGame.value;
      settingsEnabledGameTools.value = [...defaultEnabledGameToolsForGame(resolvedGame)];
    }
    pendingGameChoice.value = null;
    showGameChangeWarning.value = false;
    await saveGameSettings(false);
  }

  function cancelGameSelectionChange() {
    pendingGameChoice.value = null;
    showGameChangeWarning.value = false;
  }

  function openChatOverlay() {
    showToolOverlay.value = false;
    closeRulebookViewer();
    showChatOverlay.value = true;
  }

  function openToolOverlay() {
    showChatOverlay.value = false;
    closeRulebookViewer();
    showToolOverlay.value = true;
  }

  function closeOverlays() {
    showGameOverlay.value = false;
    showChatOverlay.value = false;
    showToolOverlay.value = false;
    showRulebookViewer.value = false;
    rulebookViewerUrl.value = "";
    pendingGameChoice.value = null;
    showGameChangeWarning.value = false;
    if (!isDeletingChat.value) showDeleteChatConfirm.value = false;
  }

  function closeRulebookViewer() {
    showRulebookViewer.value = false;
    rulebookViewerUrl.value = "";
    rulebookMissingGame.value = "";
  }

  function openRulebook() {
    showChatOverlay.value = false;
    showToolOverlay.value = false;
    const game = currentChatGame.value;
    rulebookMissingGame.value = (game || "").trim() || "this game";
    const url = resolveRulebookUrl(game);
    rulebookViewerUrl.value = url || "";
    showRulebookViewer.value = true;
  }

  function openRulebookInNewTab() {
    const url = rulebookViewerUrl.value || resolveRulebookUrl(currentChatGame.value);
    if (url && typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  function togglePlayersDropdown() {
    showPlayersDropdown.value = !showPlayersDropdown.value;
  }

  /** Ticks on an interval so "recently active" styling updates without new messages. */
  const playerActivityClock = ref(0);
  let playerActivityClockTimerId = null;

  const myMessage = ref("");

  const partyupChannelMessageSchema = {
    properties: {
      value: {
        required: ["content", "published"],
        properties: {
          content: { type: "string" },
          published: { type: "number" },
          partyupLeave: { type: "boolean" },
          partyupJoin: { type: "boolean" },
          profileId: { type: "string" },
          profileName: { type: "string" },
          profileAvatar: { type: "string" },
          privateToActor: { type: "string" },
          privateToNickname: { type: "string" },
          replyToUrl: { type: "string" },
          replyToPreview: { type: "string" },
          replyToAuthorName: { type: "string" },
        },
      },
    },
  };

  const { objects: messageObjects, isFirstPoll: areMessageObjectsLoading } = useGraffitiDiscover(
    () => (session.value && channel.value ? [channel.value] : []),
    partyupChannelMessageSchema,
    undefined,
    true,
  );

  /** Actors currently in the room (join ping / messages vs leave ping), excluding bans. */
  const participantActors = computed(() => {
    const raw = presentParticipantActorSet(currentChat.value, messageObjects.value);
    for (const id of bannedActorsEffective.value) raw.delete(id);
    return raw;
  });

  const participantCount = computed(() => participantActors.value.size);

  watch(
    [channel, participantCount, currentChatName],
    () => {
      const ch = channel.value;
      if (!ch) {
        headerChatLivePlayers.value = null;
        return;
      }
      headerChatLivePlayers.value = {
        channel: ch,
        inRoom: participantCount.value,
        title: currentChatName.value,
      };
    },
    { immediate: true },
  );

  onUnmounted(() => {
    persistMessageListScroll();
    if (typeof window !== "undefined" && scrollSaveTimer !== null) {
      window.clearTimeout(scrollSaveTimer);
      scrollSaveTimer = null;
    }
    if (headerChatLivePlayers.value?.channel === channel.value) {
      headerChatLivePlayers.value = null;
    }
    if (sendShakeTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(sendShakeTimer);
      sendShakeTimer = null;
    }
    if (scrollAfterSendFallbackTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(scrollAfterSendFallbackTimer);
      scrollAfterSendFallbackTimer = null;
    }
  });

  const currentUserIsParticipant = computed(
    () => Boolean(session.value?.actor && participantActors.value.has(session.value.actor)),
  );

  const joinBlockedKind = computed(() => {
    if (!channel.value || !session.value?.actor || !currentChat.value) return null;
    if (bannedActorsEffective.value.includes(session.value.actor)) return "banned";
    if (currentUserIsParticipant.value) return null;
    if (
      participantCount.value >= maxPlayersEffective.value &&
      !spectatingEnabledEffective.value
    ) {
      return "full";
    }
    return null;
  });

  const joinBlocked = computed(() => joinBlockedKind.value != null);

  const roomIsFull = computed(
    () => participantCount.value >= maxPlayersEffective.value,
  );

  const knownChatStorageRevision = ref(0);

  const knownChatSpectatorStored = computed(() => {
    void knownChatStorageRevision.value;
    const ch = channel.value;
    const ses = session.value;
    if (!ch || !ses) return false;
    return lookupKnownChatSpectator(ses, ch);
  });

  const isSpectatorSession = computed(() => {
    if (!session.value?.actor || !channel.value || !currentChat.value) return false;
    if (bannedActorsEffective.value.includes(session.value.actor)) return false;
    if (currentUserIsParticipant.value) return false;
    if (knownChatSpectatorStored.value) return true;
    return roomIsFull.value && spectatingEnabledEffective.value;
  });

  /**
   * Spectator sidebar + read-only chrome: confirmed spectator, or still loading messages in a
   * spectating-enabled room (join ping must not run until occupancy is trustworthy).
   */
  const showSpectatorChrome = computed(() => {
    if (!session.value?.actor || !channel.value || !currentChat.value) return false;
    if (bannedActorsEffective.value.includes(session.value.actor)) return false;
    if (currentUserIsParticipant.value) return false;
    if (!spectatingEnabledEffective.value) return false;
    return areMessageObjectsLoading.value || isSpectatorSession.value;
  });

  watch(
    () => ({
      ch: channel.value,
      spec: spectatingEnabledEffective.value,
      full: roomIsFull.value,
      part: currentUserIsParticipant.value,
      actor: session.value?.actor,
      banned:
        Boolean(session.value?.actor) &&
        bannedActorsEffective.value.includes(session.value.actor),
    }),
    (s) => {
      if (!s.ch || !s.actor || s.banned || s.part || !s.spec || !s.full) return;
      if (lookupKnownChatSpectator(session.value, s.ch)) return;
      const all = loadAllKnownChats();
      addKnownChat(all, session.value, { channel: s.ch, spectator: true });
      knownChatStorageRevision.value++;
    },
    { immediate: true },
  );

  const joinAsPlayerBusy = ref(false);

  const canJoinAsPlayerFromSpectator = computed(
    () =>
      !areMessageObjectsLoading.value &&
      isSpectatorSession.value &&
      !joinAsPlayerBusy.value &&
      participantCount.value < maxPlayersEffective.value,
  );

  async function joinChatAsPlayerFromSpectator() {
    if (!session.value?.actor || !channel.value || !canJoinAsPlayerFromSpectator.value) return;
    joinAsPlayerBusy.value = true;
    try {
      const all = loadAllKnownChats();
      addKnownChat(all, session.value, {
        channel: channel.value,
        spectator: false,
      });
      knownChatStorageRevision.value++;
      const messageValue = {
        content: "",
        published: Date.now(),
        partyupJoin: true,
      };
      if (activeProfile.value?.id) messageValue.profileId = activeProfile.value.id;
      if (activeProfile.value?.name) messageValue.profileName = activeProfile.value.name;
      if (activeProfile.value?.avatar) messageValue.profileAvatar = activeProfile.value.avatar;
      await graffiti.post({ value: messageValue, channels: [channel.value] }, session.value);
      joinPingPostedForChannel.value = channel.value;
    } catch (e) {
      console.error(e);
    } finally {
      joinAsPlayerBusy.value = false;
    }
  }

  async function postPartyupJoinPing() {
    if (
      !session.value?.actor ||
      !channel.value ||
      joinBlocked.value ||
      isSpectatorSession.value ||
      areMessageObjectsLoading.value
    )
      return;
    const messageValue = {
      content: "",
      published: Date.now(),
      partyupJoin: true,
    };
    if (activeProfile.value?.id) messageValue.profileId = activeProfile.value.id;
    if (activeProfile.value?.name) messageValue.profileName = activeProfile.value.name;
    if (activeProfile.value?.avatar) messageValue.profileAvatar = activeProfile.value.avatar;
    await graffiti.post({ value: messageValue, channels: [channel.value] }, session.value);
  }

  async function postPartyupLeavePing() {
    if (!session.value?.actor || !channel.value) return;
    const messageValue = {
      content: "",
      published: Date.now(),
      partyupLeave: true,
    };
    if (activeProfile.value?.id) messageValue.profileId = activeProfile.value.id;
    if (activeProfile.value?.name) messageValue.profileName = activeProfile.value.name;
    if (activeProfile.value?.avatar) messageValue.profileAvatar = activeProfile.value.avatar;
    await graffiti.post({ value: messageValue, channels: [channel.value] }, session.value);
  }

  watch(
    () => [
      channel.value,
      session.value?.actor,
      joinBlocked.value,
      isSpectatorSession.value,
      areMessageObjectsLoading.value,
    ],
    async ([ch, actor, blocked, spect, loading]) => {
      if (!ch || !actor || blocked || spect || loading) {
        return;
      }
      if (joinPingPostedForChannel.value === ch) return;
      try {
        await postPartyupJoinPing();
        joinPingPostedForChannel.value = ch;
      } catch (e) {
        console.error(e);
      }
    },
    { immediate: true },
  );

  watch(
    () => activeProfile.value?.id,
    async (newId, oldId) => {
      if (
        !newId ||
        !channel.value ||
        !session.value?.actor ||
        joinBlocked.value ||
        isSpectatorSession.value ||
        areMessageObjectsLoading.value
      )
        return;
      if (joinPingPostedForChannel.value !== channel.value) return;
      if (oldId === undefined) return;
      try {
        await postPartyupJoinPing();
      } catch (e) {
        console.error(e);
      }
    },
  );

  const isChatCreator = computed(
    () =>
      Boolean(
        session.value?.actor &&
          currentChat.value?.actor &&
          session.value.actor === currentChat.value.actor,
      ),
  );

  const showSidebarInviteSection = computed(() => isChatCreator.value || !inviteLockedEffective.value);

  const roomEnteredAt = ref(0);

  async function postHostChatUpdate(overrides = {}) {
    if (!session.value?.actor || !channel.value || !isChatCreator.value) return;
    const cap = clampPlayerCap(overrides.players ?? maxPlayersEffective.value);
    const game = overrides.game ?? currentChatGame.value;
    const inviteL = overrides.inviteLocked ?? inviteLockedEffective.value;
    const banned = overrides.bannedActors ?? [...bannedActorsEffective.value];
    const kicks = overrides.kickTimestamps ?? { ...kickTimestampsEffective.value };
    const enabledTools =
      overrides.enabledGameTools !== undefined
        ? normalizeEnabledGameTools(overrides.enabledGameTools)
        : effectiveEnabledGameTools(chats.value, channel.value);
    const titleOverride =
      overrides.title !== undefined ? String(overrides.title).trim() : null;
    const title =
      (titleOverride && titleOverride) ||
      effectiveChatTitle(chats.value, channel.value) ||
      String(currentChat.value?.value?.title || "").trim() ||
      "Chat";
    const specEn =
      overrides.spectatingEnabled !== undefined
        ? Boolean(overrides.spectatingEnabled)
        : spectatingEnabledEffective.value;
    await graffiti.post(
      {
        value: {
          activity: "Update",
          type: "Chat",
          channel: channel.value,
          title,
          players: cap,
          game,
          published: Date.now(),
          inviteLocked: inviteL,
          spectatingEnabled: specEn,
          enabledGameTools: enabledTools,
          bannedActors: banned,
          kickTimestamps: kicks,
        },
        channels: ["partyup-26"],
      },
      session.value,
    );
  }

  /**
   * @param {boolean} [closeAfter=true] Close Game Settings after a successful save (manual Save / submit).
   */
  async function saveGameSettings(closeAfter = true) {
    if (!session.value || !channel.value || !isChatCreator.value) return;
    settingsSaveError.value = "";
    const cap = clampPlayerCap(settingsMaxPlayers.value);
    if (cap < participantCount.value) {
      settingsSaveError.value = `Limit must be at least ${participantCount.value} (players already in this chat).`;
      return;
    }
    const resolvedGame =
      settingsGame.value === "Other"
        ? settingsOtherGameDetail.value.trim() || "Other"
        : settingsGame.value;
    const resolvedChatTitle = settingsChatTitle.value.trim();
    try {
      await postHostChatUpdate({
        title:
          resolvedChatTitle ||
          effectiveChatTitle(chats.value, channel.value) ||
          String(currentChat.value?.value?.title || "").trim() ||
          defaultKnownChatTitle(channel.value),
        players: cap,
        game: resolvedGame,
        inviteLocked: settingsInviteLocked.value,
        spectatingEnabled: settingsSpectatingEnabled.value,
        enabledGameTools: normalizeEnabledGameTools(settingsEnabledGameTools.value),
        bannedActors: [...bannedActorsEffective.value],
        kickTimestamps: { ...kickTimestampsEffective.value },
      });
      if (closeAfter) closeOverlays();
    } catch (error) {
      console.error(error);
      settingsSaveError.value = error?.message || "Could not save settings.";
    }
  }

  /** Auto-save custom "Other" title without closing the overlay. */
  async function saveOtherGameDetailIfNeeded() {
    if (!showGameOverlay.value || !isChatCreator.value) return;
    if (settingsGame.value !== "Other") return;
    await saveGameSettings(false);
  }

  async function kickPlayer(actorId) {
    moderationError.value = "";
    if (!session.value?.actor || !channel.value || !isChatCreator.value) return;
    if (!actorId || actorId === session.value.actor || actorId === currentChat.value?.actor) return;
    if (
      !confirm(
        "Kick this player from the session? They can rejoin using the invite link if they still have access.",
      )
    ) {
      return;
    }
    moderationBusyActor.value = actorId;
    moderationBusyKind.value = "kick";
    try {
      await postHostChatUpdate({
        kickTimestamps: { ...kickTimestampsEffective.value, [actorId]: Date.now() },
      });
    } catch (error) {
      console.error(error);
      moderationError.value = error?.message || "Could not kick player.";
    } finally {
      moderationBusyActor.value = null;
      moderationBusyKind.value = null;
    }
  }

  async function banPlayer(actorId) {
    moderationError.value = "";
    if (!session.value?.actor || !channel.value || !isChatCreator.value) return;
    if (!actorId || actorId === session.value.actor || actorId === currentChat.value?.actor) return;
    if (bannedActorsEffective.value.includes(actorId)) return;
    if (
      !confirm(
        "Ban this player from this chat? They will not be able to rejoin while the ban remains in place.",
      )
    ) {
      return;
    }
    moderationBusyActor.value = actorId;
    moderationBusyKind.value = "ban";
    try {
      const banned = [...bannedActorsEffective.value, actorId];
      await postHostChatUpdate({
        bannedActors: banned,
        kickTimestamps: { ...kickTimestampsEffective.value, [actorId]: Date.now() },
      });
    } catch (error) {
      console.error(error);
      moderationError.value = error?.message || "Could not ban player.";
    } finally {
      moderationBusyActor.value = null;
      moderationBusyKind.value = null;
    }
  }

  async function unbanPlayer(actorId) {
    moderationError.value = "";
    if (!session.value?.actor || !channel.value || !isChatCreator.value) return;
    if (!actorId || actorId === session.value.actor || actorId === currentChat.value?.actor) return;
    if (!bannedActorsEffective.value.includes(actorId)) return;
    if (
      !confirm(
        "Remove this ban? They will be able to join the chat again when there is room and they have access.",
      )
    ) {
      return;
    }
    moderationBusyActor.value = actorId;
    moderationBusyKind.value = "unban";
    try {
      const banned = bannedActorsEffective.value.filter((id) => id !== actorId);
      await postHostChatUpdate({
        bannedActors: banned,
        kickTimestamps: { ...kickTimestampsEffective.value },
      });
    } catch (error) {
      console.error(error);
      moderationError.value = error?.message || "Could not remove ban.";
    } finally {
      moderationBusyActor.value = null;
      moderationBusyKind.value = null;
    }
  }

  let kickLeaveHandled = false;
  watch(channel, () => {
    kickLeaveHandled = false;
    roomEnteredAt.value = 0;
  });

  watch(
    () => [channel.value, joinBlocked.value],
    ([ch, blocked]) => {
      if (ch && !blocked) roomEnteredAt.value = Date.now();
    },
    { immediate: true },
  );

  watch(
    () => ({
      ch: channel.value,
      me: session.value?.actor,
      blocked: joinBlocked.value,
      kicks: kickTimestampsEffective.value,
      entered: roomEnteredAt.value,
    }),
    (state) => {
      if (!state.ch || !state.me || state.blocked || kickLeaveHandled) return;
      const kt = state.kicks[state.me];
      if (kt != null && state.entered > 0 && kt > state.entered) {
        kickLeaveHandled = true;
        leaveChat();
      }
    },
  );

  const settingsMinPlayers = computed(() => Math.max(1, participantCount.value));

  const sortedMessageObjects = computed(() => {
    return messageObjects.value.toSorted((a, b) => {
      return a.value.published - b.value.published;
    });
  });

  /** Latest profile name/avatar per actor by published time (chat + join pings; excludes leave rows). */
  const actorProfileDirectory = computed(() => {
    const best = new Map();
    for (const messageObject of messageObjects.value) {
      const actorId = messageObject.actor;
      if (!actorId) continue;
      if (messageObject.value?.partyupLeave) continue;
      const pub = Number(messageObject.value?.published) || 0;
      const prev = best.get(actorId);
      if (!prev || pub >= prev.pub) {
        best.set(actorId, {
          pub,
          meta: {
            actor: actorId,
            name: messageObject.value.profileName || "Unknown user",
            avatar: messageObject.value.profileAvatar || "",
          },
        });
      }
    }
    const directory = new Map();
    for (const [, row] of best) directory.set(row.meta.actor, row.meta);
    return directory;
  });

  const profileNameToActorDirectory = computed(() => {
    const directory = new Map();
    for (const user of actorProfileDirectory.value.values()) {
      const normalizedName = (user.name || "").trim().toLowerCase();
      if (normalizedName) directory.set(normalizedName, user.actor);
    }
    return directory;
  });

  const coplaySidebarTick = ref(0);
  watch(channel, () => {
    inviteUserActorInput.value = "";
    invitePushFeedback.value = "";
    showInviteUserSuggestDropdown.value = false;
  });

  watch(
    () => ({
      dir: actorProfileDirectory.value,
      ch: channel.value,
      me: session.value?.actor,
      blocked: joinBlocked.value || showSpectatorChrome.value,
    }),
    (s) => {
      if (!s.me || !s.ch) return;
      recordCoplayActors(session.value, s.ch, s.dir, s.blocked);
      coplaySidebarTick.value++;
    },
    { immediate: true },
  );

  const coplayersForInviteSidebar = computed(() => {
    void coplaySidebarTick.value;
    return getCoplayActorsForSidebar(session.value, 15);
  });

  /** Short list for the Invite user dropdown (max 5 recent co-players). */
  const coplayersForInviteDropdown = computed(() => {
    void coplaySidebarTick.value;
    return getCoplayActorsForSidebar(session.value, 5);
  });

  const inviteUserActorInput = ref("");
  const invitePushBusy = ref(false);
  const invitePushFeedback = ref("");
  const showInviteUserSuggestDropdown = ref(false);
  const inviteUserSuggestRoot = ref(null);
  const inviteSectionExpanded = ref(true);

  function toggleInviteSectionExpanded() {
    inviteSectionExpanded.value = !inviteSectionExpanded.value;
    if (!inviteSectionExpanded.value) showInviteUserSuggestDropdown.value = false;
  }

  function toggleInviteUserSuggestDropdown() {
    if (!coplayersForInviteDropdown.value.length) return;
    showInviteUserSuggestDropdown.value = !showInviteUserSuggestDropdown.value;
  }

  function selectInviteUserSuggestion(row) {
    if (!row?.actorId) return;
    inviteUserActorInput.value =
      normalizeInviteToActorId(row.actorId) || String(row.actorId).trim();
    showInviteUserSuggestDropdown.value = false;
  }

  function onDocumentClickCloseInviteSuggest(ev) {
    const root = inviteUserSuggestRoot.value;
    if (!root || !showInviteUserSuggestDropdown.value) return;
    if (root.contains(ev.target)) return;
    showInviteUserSuggestDropdown.value = false;
  }

  const canSendInvitePush = computed(() => {
    const rawIn = inviteUserActorInput.value.trim().replace(/^@/, "");
    const meAct = sessionActorIdForInvites(session.value);
    return Boolean(rawIn && channel.value && meAct && !invitePushBusy.value);
  });

  const visibleMessageObjects = computed(() => {
    const currentActor = session.value?.actor;
    return sortedMessageObjects.value.filter((messageObject) => {
      if (isPartyupPresenceMessage(messageObject)) return false;
      const v = messageObject.value || {};
      const privateToActor = v.privateToActor;
      const body = String(v.content ?? "").trim();
      const hasReplyQuote = Boolean(v.replyToUrl);
      if (!body && !privateToActor && !hasReplyQuote) {
        return false;
      }
      if (!privateToActor) return true;
      return messageObject.actor === currentActor || privateToActor === currentActor;
    });
  });

  const messageListEl = ref(null);

  const searchableChatUsers = computed(() => {
    const present = participantActors.value;
    const map = new Map(actorProfileDirectory.value);
    const creatorId = currentChat.value?.actor;
    if (creatorId && present.has(creatorId) && !map.has(creatorId)) {
      map.set(creatorId, {
        actor: creatorId,
        name: (currentChatName.value || "").trim() || "Host",
        avatar: "",
      });
    }
    const out = [];
    for (const u of map.values()) {
      if (present.has(u.actor)) out.push(u);
    }
    return out.sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), undefined, {
        sensitivity: "base",
      }),
    );
  });

  const chatSearchQuery = ref("");
  const chatSearchInputEl = ref(null);
  const chatSearchCursor = ref(0);
  const chatSearchMentionSuggestions = ref([]);

  const chatSearchParsed = computed(() => parseChatSearchQuery(chatSearchQuery.value.trim()));

  const chatSearchResults = computed(() => {
    const trimmed = chatSearchQuery.value.trim();
    if (!trimmed) return [];
    const parsed = chatSearchParsed.value;
    if (parsed.mentionNames.length === 0 && parsed.keywords.length === 0) return [];
    const nameToActor = profileNameToActorDirectory.value;
    const actorDir = actorProfileDirectory.value;
    const out = [];
    for (const msg of visibleMessageObjects.value) {
      if (messageMatchesChatSearch(msg, parsed, nameToActor, actorDir)) {
        out.push(msg);
        if (out.length >= 150) break;
      }
    }
    return out;
  });

  function updateChatSearchMentionSuggestions() {
    const q = chatSearchQuery.value;
    const pos = chatSearchCursor.value;
    const state = getActiveChatSearchMention(q, pos);
    if (!state) {
      chatSearchMentionSuggestions.value = [];
      return;
    }
    const pref = (state.prefix || "").toLowerCase();
    const users = searchableChatUsers.value.filter((u) =>
      (u.name || "").toLowerCase().startsWith(pref),
    );
    chatSearchMentionSuggestions.value = users.slice(0, 12);
  }

  function onChatSearchInput(e) {
    chatSearchCursor.value = e.target.selectionStart ?? chatSearchQuery.value.length;
    updateChatSearchMentionSuggestions();
  }

  function onChatSearchSelect(e) {
    chatSearchCursor.value = e.target.selectionStart ?? chatSearchQuery.value.length;
    updateChatSearchMentionSuggestions();
  }

  function onChatSearchKeydown() {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const el = chatSearchInputEl.value;
      chatSearchCursor.value = el?.selectionStart ?? chatSearchQuery.value.length;
      updateChatSearchMentionSuggestions();
    });
  }

  function applyChatSearchUserSuggestion(user) {
    const q = chatSearchQuery.value;
    const pos = chatSearchCursor.value;
    const state = getActiveChatSearchMention(q, pos);
    if (!state) return;
    const insert = `@[${user.name}] `;
    chatSearchQuery.value = q.slice(0, state.replaceStart) + insert + q.slice(state.replaceEnd);
    chatSearchMentionSuggestions.value = [];
    nextTick(() => {
      const el = chatSearchInputEl.value;
      if (el) {
        const caret = state.replaceStart + insert.length;
        el.setSelectionRange(caret, caret);
        el.focus();
      }
      updateChatSearchMentionSuggestions();
    });
  }

  function formatChatSearchSnippet(content, maxLen = 130) {
    const t = (content || "").trim().replace(/\s+/g, " ");
    if (t.length <= maxLen) return t;
    return `${t.slice(0, maxLen - 1)}…`;
  }

  function formatMessageSearchTime(ts) {
    try {
      return new Date(ts || 0).toLocaleString();
    } catch {
      return "";
    }
  }

  function escapeMessageUrlForSelector(url) {
    return String(url || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function scrollToChatSearchResult(messageObject) {
    closeOverlays();
    nextTick(() => {
      const container = messageListEl.value;
      const sel = `[data-message-url="${escapeMessageUrlForSelector(messageObject.url)}"]`;
      const el = container?.querySelector(sel);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("message-search-flash");
        window.setTimeout(() => el.classList.remove("message-search-flash"), 2400);
      }
    });
  }

  function jumpToMessageUrl(url) {
    if (!url || typeof window === "undefined") return;
    nextTick(() => {
      const container = messageListEl.value;
      const sel = `[data-message-url="${escapeMessageUrlForSelector(url)}"]`;
      const el = container?.querySelector(sel);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("message-search-flash");
        window.setTimeout(() => el.classList.remove("message-search-flash"), 2400);
      }
    });
  }

  watch(showChatOverlay, (open) => {
    if (open) {
      nextTick(() => {
        chatSearchInputEl.value?.focus();
        chatSearchCursor.value = chatSearchQuery.value.length;
        updateChatSearchMentionSuggestions();
      });
    }
  });

  const messageTimelineRows = computed(() => {
    const rows = [];
    let prevDayKey = null;
    for (const object of visibleMessageObjects.value) {
      const ts = object.value.published ?? 0;
      const dayKey = localDayKey(ts);
      if (dayKey !== prevDayKey) {
        prevDayKey = dayKey;
        rows.push({
          type: "day",
          dayKey,
          label: formatChatDaySeparatorLabel(ts),
        });
      }
      rows.push({ type: "message", object });
    }
    return rows;
  });

  const pendingScrollAfterSend = ref(false);
  const suppressScrollPersist = ref(false);
  const scrollRestorePending = ref(true);

  function persistMessageListScroll() {
    if (suppressScrollPersist.value) return;
    if (joinBlocked.value) return;
    const el = messageListEl.value;
    const actor = session.value?.actor;
    const ch = channel.value;
    if (!el || !actor || !ch) return;
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    const ratio = maxScroll > 0 ? el.scrollTop / maxScroll : 0;
    saveScrollRatio(actor, ch, ratio);
  }

  function onMessageListScroll() {
    if (suppressScrollPersist.value) return;
    if (typeof window === "undefined") return;
    if (scrollSaveTimer !== null) {
      window.clearTimeout(scrollSaveTimer);
      scrollSaveTimer = null;
    }
    scrollSaveTimer = window.setTimeout(() => {
      scrollSaveTimer = null;
      persistMessageListScroll();
    }, 400);
  }

  watch(
    () => channel.value,
    () => {
      scrollRestorePending.value = true;
    },
  );

  async function tryRestoreMessageScroll() {
    if (!scrollRestorePending.value) return;
    if (!channel.value || joinBlocked.value) return;
    if (areMessageObjectsLoading.value) return;
    const el = messageListEl.value;
    if (!el) return;
    await nextTick();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const node = messageListEl.value;
    if (!node || !scrollRestorePending.value || joinBlocked.value) return;
    const len = visibleMessageObjects.value.length;
    let maxScroll = Math.max(0, node.scrollHeight - node.clientHeight);
    if (len > 0 && maxScroll === 0) {
      await new Promise((r) => requestAnimationFrame(r));
      maxScroll = Math.max(0, node.scrollHeight - node.clientHeight);
      if (len > 0 && maxScroll === 0) return;
    }
    const actor = session.value?.actor;
    suppressScrollPersist.value = true;
    const finalMax = Math.max(0, node.scrollHeight - node.clientHeight);
    const ratio = actor ? loadScrollRatio(actor, channel.value) : null;
    if (ratio != null && finalMax > 0) {
      node.scrollTop = ratio * finalMax;
    } else {
      node.scrollTop = finalMax;
    }
    scrollRestorePending.value = false;
    requestAnimationFrame(() => {
      suppressScrollPersist.value = false;
    });
  }

  watch(
    () => ({
      loading: areMessageObjectsLoading.value,
      blocked: joinBlocked.value,
      ch: channel.value,
      len: visibleMessageObjects.value.length,
    }),
    () => {
      void tryRestoreMessageScroll();
    },
    { flush: "post" },
  );

  function scrollMessageListToBottom() {
    const el = messageListEl.value;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  function scrollMessageListToTop() {
    const el = messageListEl.value;
    if (!el) return;
    el.scrollTop = 0;
  }

  /** ↑ — scroll to the previous calendar-day section (older messages). */
  function jumpMessageListToOlderDay() {
    const el = messageListEl.value;
    if (!el) return;
    const tops = getDaySeparatorOffsets(el);
    const st = el.scrollTop;
    let target = null;
    for (let i = tops.length - 1; i >= 0; i--) {
      if (tops[i] < st - 1) {
        target = tops[i];
        break;
      }
    }
    el.scrollTop = target !== null ? target : 0;
    requestAnimationFrame(() => persistMessageListScroll());
  }

  /** ↓ — scroll to the next calendar-day section (newer); if none, jump to latest messages. */
  function jumpMessageListToNewerDay() {
    const el = messageListEl.value;
    if (!el) return;
    const tops = getDaySeparatorOffsets(el);
    const viewBottom = el.scrollTop + el.clientHeight;
    let target = null;
    for (const t of tops) {
      if (t > viewBottom - 1) {
        target = t;
        break;
      }
    }
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = target !== null ? target : maxScroll;
    requestAnimationFrame(() => persistMessageListScroll());
  }

  function onScrollChatTopFromHeader() {
    scrollMessageListToTop();
  }

  onMounted(() => {
    if (typeof window !== "undefined") {
      chatLayoutMql = window.matchMedia(CHAT_LAYOUT_NARROW_MQ);
      syncChatLayoutNarrow();
      chatLayoutMql.addEventListener("change", syncChatLayoutNarrow);
      window.addEventListener(PARTYUP_SCROLL_CHAT_TOP_EVENT, onScrollChatTopFromHeader);
      window.addEventListener("click", onDocumentClickCloseInviteSuggest);
      playerActivityClockTimerId = window.setInterval(() => {
        playerActivityClock.value++;
      }, 30000);
    }
  });

  onUnmounted(() => {
    if (typeof window !== "undefined") {
      chatLayoutMql?.removeEventListener("change", syncChatLayoutNarrow);
      chatLayoutMql = null;
      window.removeEventListener(PARTYUP_SCROLL_CHAT_TOP_EVENT, onScrollChatTopFromHeader);
      window.removeEventListener("click", onDocumentClickCloseInviteSuggest);
      if (playerActivityClockTimerId != null) {
        window.clearInterval(playerActivityClockTimerId);
        playerActivityClockTimerId = null;
      }
    }
  });

  function scheduleScrollToBottomAfterSend() {
    void nextTick(() => {
      scrollMessageListToBottom();
      requestAnimationFrame(() => {
        scrollMessageListToBottom();
        persistMessageListScroll();
      });
    });
  }

  watch(
    () => visibleMessageObjects.value.length,
    async (len, prevLen) => {
      if (!pendingScrollAfterSend.value) return;
      if (prevLen !== undefined && len <= prevLen) return;
      pendingScrollAfterSend.value = false;
      if (scrollAfterSendFallbackTimer !== null && typeof window !== "undefined") {
        window.clearTimeout(scrollAfterSendFallbackTimer);
        scrollAfterSendFallbackTimer = null;
      }
      await nextTick();
      scrollMessageListToBottom();
      requestAnimationFrame(() => {
        scrollMessageListToBottom();
        persistMessageListScroll();
      });
    },
    { flush: "post" },
  );

  const otherUsersInChat = computed(() => {
    void playerActivityClock.value;
    const currentActor = session.value?.actor;
    const present = participantActors.value;
    const dir = actorProfileDirectory.value;
    const msgs = messageObjects.value;
    const rows = [];
    for (const actorId of present) {
      if (!actorId || actorId === currentActor) continue;
      const meta = dir.get(actorId);
      if (!meta) continue;
      let lastPublished = 0;
      for (const m of msgs) {
        if (m.actor !== actorId) continue;
        const v = m.value || {};
        if (v.partyupLeave) continue;
        const pub = Number(v.published) || 0;
        if (pub > lastPublished) lastPublished = pub;
      }
      rows.push({
        actor: actorId,
        name: meta.name,
        avatar: meta.avatar,
        isRecent: Date.now() - lastPublished < PARTYUP_PLAYER_RECENT_ACTIVITY_MS,
      });
    }
    return rows.sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), undefined, {
        sensitivity: "base",
      }),
    );
  });

  /** Banned actor ids with display names from chat history when available. */
  const bannedUsersDisplay = computed(() => {
    const dir = actorProfileDirectory.value;
    const rows = [];
    for (const actorId of bannedActorsEffective.value) {
      const meta = dir.get(actorId);
      const rawId = String(actorId ?? "");
      const shortId =
        rawId.length > 14 ? `${rawId.slice(0, 10)}…` : rawId || "unknown";
      rows.push({
        actor: actorId,
        name: meta?.name || `Unknown (${shortId})`,
        avatar: meta?.avatar || "",
      });
    }
    return rows.sort((a, b) =>
      String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }),
    );
  });

  function extractPrivateMention(messageText) {
    const mentionMatch = messageText.match(/^@\[(.+?)\]\s*/);
    if (!mentionMatch) return null;
    return {
      nickname: mentionMatch[1].trim(),
      body: messageText.slice(mentionMatch[0].length),
      prefix: mentionMatch[0],
    };
  }

  function setPrivateDraftTarget(actorId, nickname) {
    if (!actorId || actorId === session.value?.actor) return;
    if (!participantActors.value.has(actorId)) return;
    const safeNickname = (nickname || "User").trim() || "User";
    const prefix = `@[${safeNickname}] `;
    const existingMention = extractPrivateMention(myMessage.value);
    if (existingMention) {
      myMessage.value = `${prefix}${existingMention.body}`;
    } else {
      myMessage.value = `${prefix}${myMessage.value}`;
    }
    privateMessageTarget.value = { actor: actorId, name: safeNickname };
  }

  function onProfileAvatarClick(messageObject) {
    if (showSpectatorChrome.value || areMessageObjectsLoading.value) return;
    if (messageObject.actor === session.value?.actor) return;
    if (!participantActors.value.has(messageObject.actor)) return;
    const nickname = messageObject.value.profileName || "User";
    setPrivateDraftTarget(messageObject.actor, nickname);
  }

  function onPlayerClick(user) {
    if (showSpectatorChrome.value || areMessageObjectsLoading.value) return;
    setPrivateDraftTarget(user.actor, user.name || "User");
  }

  function beginReplyTo(messageObject) {
    if (showSpectatorChrome.value || areMessageObjectsLoading.value) return;
    if (!messageObject?.url || isPartyupPresenceMessage(messageObject)) return;
    const me = session.value?.actor;
    if (!me) return;
    const v = messageObject.value || {};
    const rawContent = String(v.content || "").trim();
    const preview = rawContent ? truncateReplyPreview(rawContent) : "(no text)";
    replyDraftTarget.value = {
      url: messageObject.url,
      authorName: (v.profileName || "").trim() || "User",
      preview,
      pmRecipient: replyPrivateRecipient(messageObject, me),
    };
    showProfileMenu.value = false;
    cancelProfileDraft();
    showPlayersDropdown.value = false;
  }

  function cancelReplyDraft() {
    replyDraftTarget.value = null;
  }

  function handleMessageInput() {
    const mentionData = extractPrivateMention(myMessage.value);
    if (!mentionData) {
      privateMessageTarget.value = null;
      return;
    }

    const normalizedName = mentionData.nickname.toLowerCase();
    const resolvedActor = profileNameToActorDirectory.value.get(normalizedName) || null;
    if (!resolvedActor) {
      privateMessageTarget.value = null;
      return;
    }
    if (!participantActors.value.has(resolvedActor)) {
      privateMessageTarget.value = null;
      return;
    }
    privateMessageTarget.value = { actor: resolvedActor, name: mentionData.nickname };
  }

  const isSending = ref(false);
  const selectedDiceSides = ref(20);
  const isRollingDice = ref(false);
  const isSendLabelShaking = ref(false);
  let sendShakeTimer = null;

  function triggerEmptySendShake() {
    if (typeof window === "undefined") return;
    if (sendShakeTimer !== null) {
      window.clearTimeout(sendShakeTimer);
      sendShakeTimer = null;
    }
    isSendLabelShaking.value = false;
    window.requestAnimationFrame(() => {
      isSendLabelShaking.value = true;
      sendShakeTimer = window.setTimeout(() => {
        isSendLabelShaking.value = false;
        sendShakeTimer = null;
      }, 340);
    });
  }

  function attemptSendMessage() {
    if (showSpectatorChrome.value || areMessageObjectsLoading.value) return;
    if (isSending.value) return;
    if (!myMessage.value.trim()) {
      triggerEmptySendShake();
      return;
    }
    void sendMessage();
  }

  async function sendMessage() {
    if (!session.value || !channel.value) return;
    if (joinBlocked.value || showSpectatorChrome.value || areMessageObjectsLoading.value) return;
    const draftMessage = myMessage.value.trim();
    if (!draftMessage) return;
    sendError.value = "";

    const replyCtx = replyDraftTarget.value;

    let messageContent = draftMessage;
    let privateToActor = null;
    let privateToNickname = null;

    if (replyCtx?.pmRecipient) {
      privateToActor = replyCtx.pmRecipient.actor;
      privateToNickname = replyCtx.pmRecipient.nickname;
    } else {
      const mentionData = extractPrivateMention(draftMessage);
      if (mentionData) {
        const resolvedActor =
          privateMessageTarget.value?.name === mentionData.nickname
            ? privateMessageTarget.value.actor
            : profileNameToActorDirectory.value.get(mentionData.nickname.toLowerCase()) || null;
        if (resolvedActor && resolvedActor !== session.value.actor) {
          privateToActor = resolvedActor;
          privateToNickname = mentionData.nickname;
          messageContent = mentionData.body.trim();
          if (!messageContent) return;
        }
      }
    }

    if (privateToActor && !participantActors.value.has(privateToActor)) {
      sendError.value = "That player is not in the chat right now.";
      return;
    }

    isSending.value = true;
    pendingScrollAfterSend.value = false;
    if (typeof window !== "undefined" && scrollAfterSendFallbackTimer !== null) {
      window.clearTimeout(scrollAfterSendFallbackTimer);
      scrollAfterSendFallbackTimer = null;
    }
    try {
      const messageValue = {
        content: messageContent,
        published: Date.now(),
      };
      if (activeProfile.value?.id) messageValue.profileId = activeProfile.value.id;
      if (activeProfile.value?.name) messageValue.profileName = activeProfile.value.name;
      if (activeProfile.value?.avatar) messageValue.profileAvatar = activeProfile.value.avatar;
      if (privateToActor) messageValue.privateToActor = privateToActor;
      if (privateToNickname) messageValue.privateToNickname = privateToNickname;
      if (replyCtx) {
        messageValue.replyToUrl = replyCtx.url;
        messageValue.replyToPreview = replyCtx.preview;
        messageValue.replyToAuthorName = replyCtx.authorName;
      }

      await graffiti.post(
        {
          value: messageValue,
          channels: [channel.value],
        },
        session.value,
      );
      myMessage.value = "";
      privateMessageTarget.value = null;
      replyDraftTarget.value = null;
      pendingScrollAfterSend.value = true;
      scheduleScrollToBottomAfterSend();
      if (typeof window !== "undefined") {
        scrollAfterSendFallbackTimer = window.setTimeout(() => {
          scrollAfterSendFallbackTimer = null;
          if (!pendingScrollAfterSend.value) return;
          scrollMessageListToBottom();
          pendingScrollAfterSend.value = false;
          persistMessageListScroll();
        }, 280);
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      sendError.value = error?.message || "Failed to send message.";
    } finally {
      isSending.value = false;
    }
  }

  async function rollDiceAndPmSelf() {
    if (!session.value?.actor || !channel.value) return;
    if (joinBlocked.value || showSpectatorChrome.value || areMessageObjectsLoading.value) return;
    const sides = Math.floor(Number(selectedDiceSides.value));
    if (!Number.isFinite(sides) || sides < 1) return;
    isRollingDice.value = true;
    sendError.value = "";
    pendingScrollAfterSend.value = false;
    if (typeof window !== "undefined" && scrollAfterSendFallbackTimer !== null) {
      window.clearTimeout(scrollAfterSendFallbackTimer);
      scrollAfterSendFallbackTimer = null;
    }
    try {
      const roll = Math.floor(Math.random() * sides) + 1;
      const label = `d${sides}`;
      const messageValue = {
        content: `Rolled ${label}: ${roll}`,
        published: Date.now(),
        privateToActor: session.value.actor,
        privateToNickname: (activeProfile.value?.name || "").trim() || "You",
      };
      if (activeProfile.value?.id) messageValue.profileId = activeProfile.value.id;
      if (activeProfile.value?.name) messageValue.profileName = activeProfile.value.name;
      if (activeProfile.value?.avatar) messageValue.profileAvatar = activeProfile.value.avatar;

      await graffiti.post(
        {
          value: messageValue,
          channels: [channel.value],
        },
        session.value,
      );
      pendingScrollAfterSend.value = true;
      scheduleScrollToBottomAfterSend();
      if (typeof window !== "undefined") {
        scrollAfterSendFallbackTimer = window.setTimeout(() => {
          scrollAfterSendFallbackTimer = null;
          if (!pendingScrollAfterSend.value) return;
          scrollMessageListToBottom();
          pendingScrollAfterSend.value = false;
          persistMessageListScroll();
        }, 280);
      }
    } catch (error) {
      console.error("Dice roll failed:", error);
      sendError.value = error?.message || "Could not roll dice.";
    } finally {
      isRollingDice.value = false;
    }
  }

  const isDeleting = ref(new Set());

  const copyChatIdStatus = ref("");

  async function writeTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }

  async function copyInviteLink() {
    const url = buildPartyupInviteLink(channel.value);
    if (!url) return;
    copyChatIdStatus.value = "";
    try {
      await writeTextToClipboard(url);
      copyChatIdStatus.value = "Invite link copied";
      window.setTimeout(() => {
        if (copyChatIdStatus.value === "Invite link copied") copyChatIdStatus.value = "";
      }, 2200);
    } catch {
      copyChatIdStatus.value = "Copy failed";
      window.setTimeout(() => {
        if (copyChatIdStatus.value === "Copy failed") copyChatIdStatus.value = "";
      }, 2500);
    }
  }

  function formatActorIdShort(actorId) {
    const s = String(actorId || "");
    return s.length > 14 ? `${s.slice(0, 10)}…` : s || "—";
  }

  async function copyInviteWithCoplayer(row) {
    const url = buildPartyupInviteLink(channel.value);
    if (!url || !row?.actorId) return;
    copyChatIdStatus.value = "";
    const text = `${url}\n\n${String(row.displayName || "Player").trim()} — actor id:\n${row.actorId}`;
    try {
      await writeTextToClipboard(text);
      copyChatIdStatus.value = "Invite + actor id copied";
      window.setTimeout(() => {
        if (copyChatIdStatus.value === "Invite + actor id copied") copyChatIdStatus.value = "";
      }, 2400);
    } catch {
      copyChatIdStatus.value = "Copy failed";
      window.setTimeout(() => {
        if (copyChatIdStatus.value === "Copy failed") copyChatIdStatus.value = "";
      }, 2500);
    }
  }

  async function sendInvitePushToUser() {
    invitePushFeedback.value = "";
    const meAct = sessionActorIdForInvites(session.value);
    const rawIn = inviteUserActorInput.value.trim().replace(/^@/, "");
    if (!channel.value || !meAct) return;
    if (!rawIn) {
      invitePushFeedback.value =
        "Use a Graffiti name (e.g. ash), full handle (ash.graffiti.actor), or pick from suggestions.";
      return;
    }
    invitePushBusy.value = true;
    try {
      let inviteActorId = "";
      if (typeof graffiti.handleToActor === "function") {
        const candidates = [];
        const pushCand = (x) => {
          const s = String(x ?? "").trim();
          if (s && !candidates.includes(s)) candidates.push(s);
        };
        pushCand(normalizeInviteToActorId(inviteUserActorInput.value));
        pushCand(normalizePartyupActorHandle(inviteUserActorInput.value));
        pushCand(rawIn.toLowerCase());
        if (rawIn !== rawIn.toLowerCase()) pushCand(rawIn);

        let lastErr = null;
        for (const c of candidates) {
          try {
            const r = await graffiti.handleToActor(c);
            if (typeof r === "string" && r.trim()) {
              inviteActorId = r.trim();
              break;
            }
          } catch (e) {
            lastErr = e;
          }
        }
        if (!inviteActorId) {
          invitePushFeedback.value =
            lastErr?.message || "Could not find a Graffiti account for that name. Check spelling.";
          return;
        }
      } else {
        inviteActorId = normalizeInviteToActorId(inviteUserActorInput.value);
        if (!inviteActorId) {
          invitePushFeedback.value =
            "Use a Graffiti name (e.g. ash), full handle (ash.graffiti.actor), or pick from suggestions.";
          return;
        }
      }
      if (!inviteActorId || typeof inviteActorId !== "string") {
        invitePushFeedback.value = "Could not resolve that name to an account.";
        return;
      }
      inviteActorId = inviteActorId.trim();
      if (inviteActorId === meAct) {
        invitePushFeedback.value = "You can’t invite yourself.";
        return;
      }
      if (
        bannedActorsEffective.value.some((id) => {
          const raw = String(id || "").trim();
          if (!raw) return false;
          if (raw === inviteActorId) return true;
          return normalizeInviteToActorId(raw) === normalizeInviteToActorId(inviteActorId);
        })
      ) {
        invitePushFeedback.value = "That player is banned from this chat.";
        return;
      }
      const title =
        effectiveChatTitle(chats.value, channel.value) ||
        String(currentChat.value?.value?.title || "").trim() ||
        "Chat";
      await graffiti.post(
        {
          value: {
            activity: "Invite",
            type: "ChatInvite",
            channel: channel.value,
            inviteToActor: inviteActorId,
            chatTitle: title,
            published: Date.now(),
          },
          channels: ["partyup-26"],
        },
        session.value,
      );
      invitePushFeedback.value = "Invite sent — they’ll see it on the Lobby.";
      inviteUserActorInput.value = "";
      showInviteUserSuggestDropdown.value = false;
      window.setTimeout(() => {
        if (invitePushFeedback.value === "Invite sent — they’ll see it on the Lobby.") {
          invitePushFeedback.value = "";
        }
      }, 3200);
    } catch (error) {
      console.error(error);
      invitePushFeedback.value = error?.message || "Could not send invite.";
    } finally {
      invitePushBusy.value = false;
    }
  }

  async function copyChatId() {
    const id = channel.value;
    if (!id) return;
    copyChatIdStatus.value = "";
    try {
      await writeTextToClipboard(id);
      copyChatIdStatus.value = "Chat ID copied";
      window.setTimeout(() => {
        if (copyChatIdStatus.value === "Chat ID copied") copyChatIdStatus.value = "";
      }, 2000);
    } catch {
      copyChatIdStatus.value = "Copy failed";
      window.setTimeout(() => {
        if (copyChatIdStatus.value === "Copy failed") copyChatIdStatus.value = "";
      }, 2500);
    }
  }

  async function deleteMessage(message) {
    isDeleting.value.add(message.url);
    try {
      await graffiti.delete(message, session.value);
    } finally {
      isDeleting.value.delete(message.url);
    }
  }

  return {
    messageListEl,
    scrollMessageListToTop,
    scrollMessageListToBottom,
    jumpMessageListToOlderDay,
    jumpMessageListToNewerDay,
    onMessageListScroll,
    myMessage,
    areMessageObjectsLoading,
    visibleMessageObjects,
    messageTimelineRows,
    isSending,
    isSendLabelShaking,
    attemptSendMessage,
    sendMessage,
    selectedDiceSides,
    isRollingDice,
    rollDiceAndPmSelf,
    isDeleting,
    deleteMessage,
    currentProfiles,
    activeProfile,
    currentChatName,
    currentChatPlayers,
    currentChatGame,
    participantCount,
    joinBlocked,
    joinBlockedKind,
    spectatingEnabledEffective,
    isSpectatorSession,
    showSpectatorChrome,
    canJoinAsPlayerFromSpectator,
    joinChatAsPlayerFromSpectator,
    joinAsPlayerBusy,
    inviteLockedEffective,
    showSidebarInviteSection,
    inviteSectionExpanded,
    toggleInviteSectionExpanded,
    coplayersForInviteSidebar,
    coplayersForInviteDropdown,
    inviteUserActorInput,
    invitePushBusy,
    invitePushFeedback,
    showInviteUserSuggestDropdown,
    inviteUserSuggestRoot,
    toggleInviteUserSuggestDropdown,
    selectInviteUserSuggestion,
    canSendInvitePush,
    sendInvitePushToUser,
    formatActorIdShort,
    copyInviteWithCoplayer,
    bannedActorsEffective,
    isChatCreator,
    settingsChatTitle,
    settingsGame,
    settingsOtherGameDetail,
    settingsMaxPlayers,
    settingsInviteLocked,
    settingsSpectatingEnabled,
    settingsEnabledGameTools,
    PARTYUP_GAME_TOOL_OPTIONS,
    settingsSaveError,
    showGameChangeWarning,
    saveGameSettings,
    saveOtherGameDetailIfNeeded,
    onSettingsGameSelection,
    confirmGameSelectionChange,
    cancelGameSelectionChange,
    PARTYUP_GAME_OPTIONS,
    PARTYUP_DICE_OPTIONS,
    showToolDice,
    showToolCatan,
    showToolBotc,
    hasAnyGameTool,
    catanCountRoads,
    catanCountSettlements,
    catanCountCities,
    catanCountVP,
    adjustCatan,
    selectedBotcRoleId,
    selectedBotcRoleDetail,
    botcRolesForSelect,
    PARTYUP_MAX_PLAYERS,
    settingsMinPlayers,
    channel,
    chatLayoutNarrow,
    chatSettingsExpanded,
    leaveChat,
    showGameOverlay,
    showChatOverlay,
    showToolOverlay,
    showRulebookViewer,
    rulebookViewerUrl,
    rulebookMissingGame,
    openRulebook,
    openRulebookInNewTab,
    closeRulebookViewer,
    showPlayersDropdown,
    openGameOverlay,
    openChatOverlay,
    openToolOverlay,
    closeOverlays,
    togglePlayersDropdown,
    otherUsersInChat,
    privateMessageTarget,
    replyDraftTarget,
    cancelReplyDraft,
    beginReplyTo,
    jumpToMessageUrl,
    sendError,
    onProfileAvatarClick,
    onPlayerClick,
    handleMessageInput,
    showProfileMenu,
    newProfileName,
    newProfileAvatar,
    toggleProfileMenu,
    editingProfileId,
    beginEditProfile,
    submitProfileForm,
    removeProfile,
    kickPlayer,
    banPlayer,
    unbanPlayer,
    bannedUsersDisplay,
    moderationBusyActor,
    moderationBusyKind,
    moderationError,
    copyInviteLink,
    copyChatId,
    copyChatIdStatus,
    forgetChatPermanently,
    openDeleteChatConfirm,
    cancelDeleteChatConfirm,
    confirmDeleteChatAsOwner,
    showDeleteChatConfirm,
    deleteChatError,
    forgetChatError,
    isDeletingChat,
    chatDisplayPrefs,
    chatSearchQuery,
    chatSearchInputEl,
    chatSearchMentionSuggestions,
    chatSearchResults,
    onChatSearchInput,
    onChatSearchSelect,
    onChatSearchKeydown,
    applyChatSearchUserSuggestion,
    formatChatSearchSnippet,
    formatMessageSearchTime,
    scrollToChatSearchResult,
  };
}

export default async () => ({
  props: ["chatId"],
  components: { UserAvatar },
  setup: chatSetup,
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
