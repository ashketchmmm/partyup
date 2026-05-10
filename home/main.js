import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useGraffiti, useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";
import {
  loadAllKnownChats,
  getCurrentUserKnownChats,
  addKnownChat as persistKnownChat,
  lookupKnownChatTitle,
} from "../shared/known-chats.js";
import {
  loadAllPendingInvites,
  addPendingInvite,
  removePendingInvite,
  getPendingInvitesForUser,
  dismissPushInviteChannel,
  clearDismissedPushInviteChannel,
  isPushInviteChannelDismissed,
  loadDismissedPushInviteChannels,
} from "../shared/pending-invites.js";
import {
  PARTYUP_INVITE_PUSH_SCHEMA,
  normalizeInviteToActorId,
  sessionActorIdForInvites,
} from "../shared/partyup-invite-push.js";
import {
  PARTYUP_GAME_OPTIONS,
  PARTYUP_MAX_PLAYERS,
  defaultEnabledGameToolsForGame,
  effectiveMaxPlayers,
  effectiveChatTitle,
  effectiveGame,
  effectiveSpectatingEnabled,
  presentParticipantActorSet,
  effectiveBannedActors,
  clampPlayerCap,
} from "../shared/chat-meta.js";
import { extractChatIdFromInviteInput } from "../shared/chat-invite.js";

/** Graffiti chat channels are created with `crypto.randomUUID()` (RFC 4122 string form). */
const CHAT_ID_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidChatChannelId(id) {
  return typeof id === "string" && CHAT_ID_UUID_RE.test(id.trim());
}

/** Preset game keys (e.g. BoTC) → lobby label; custom titles pass through. */
function formatPublicChatGameLabel(gameRaw) {
  const g = String(gameRaw || "").trim();
  if (!g) return "";
  const opt = PARTYUP_GAME_OPTIONS.find((o) => o.value === g);
  if (opt) return opt.label;
  return g;
}

function setup() {
  const route = useRoute();
  const router = useRouter();
  const graffiti = useGraffiti();
  const session = useGraffitiSession();

  const isRandomizing = ref(false);
  const chatTitle = ref("");
  const chatPlayers = ref(1);
  const chatPrivacy = ref(false);
  const chatGame = ref(PARTYUP_GAME_OPTIONS[0].value);
  const chatOtherGameDetail = ref("");
  const knownChatId = ref("");
  const allKnownChats = ref(loadAllKnownChats());
  const allPendingInvites = ref(loadAllPendingInvites());
  const allDismissedPushInvites = ref(loadDismissedPushInviteChannels());
  const showCreateChatModal = ref(false);

  watch(chatGame, (v) => {
    if (v !== "Other") chatOtherGameDetail.value = "";
  });

  function addKnownChat(chatInfo) {
    persistKnownChat(allKnownChats.value, session.value, chatInfo);
  }

  const knownChats = computed(() => {
    const list = getCurrentUserKnownChats(allKnownChats.value, session.value);
    return [...list];
  });

  watch(
    () => session.value?.actor,
    (actor) => {
      if (actor) {
        allKnownChats.value = loadAllKnownChats();
        allPendingInvites.value = loadAllPendingInvites();
        allDismissedPushInvites.value = loadDismissedPushInviteChannels();
      }
    },
    { immediate: true },
  );

  watch(
    () => router.currentRoute.value.name,
    (name) => {
      if (name === "home") {
        allKnownChats.value = loadAllKnownChats();
        allPendingInvites.value = loadAllPendingInvites();
        allDismissedPushInvites.value = loadDismissedPushInviteChannels();
      }
    },
    { immediate: true },
  );

  watch(
    () => ({
      join: route.query.join,
      name: route.name,
      actor: session.value?.actor,
    }),
    (state) => {
      if (state.name !== "home" || state.join == null || state.join === "") return;
      if (!state.actor) return;
      const raw = Array.isArray(state.join) ? state.join[0] : state.join;
      const id = extractChatIdFromInviteInput(String(raw));
      if (!id || !isValidChatChannelId(id)) return;

      const known = getCurrentUserKnownChats(allKnownChats.value, session.value);
      if (known.some((c) => c.channel === id)) {
        router.replace({ name: "chat", params: { chatId: id } });
        return;
      }

      addPendingInvite(allPendingInvites.value, session.value, id);
      router.replace({ name: "home" });
    },
    { immediate: true },
  );

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

  const { objects: invitePushObjects } = useGraffitiDiscover(
    () => (session.value ? ["partyup-26"] : []),
    PARTYUP_INVITE_PUSH_SCHEMA,
  );

  /** Stable digest so new invite objects reliably trigger ingest (discover arrays may mutate in place). */
  const invitePushIngestFingerprint = computed(() =>
    invitePushObjects.value
      .map((o) => {
        const v = o.value;
        if (!v || v.activity !== "Invite" || v.type !== "ChatInvite") return "";
        return `${String(o.url || "")}|${String(v.channel || "")}|${String(v.inviteToActor || "")}|${Number(v.published) || 0}`;
      })
      .filter(Boolean)
      .sort()
      .join("\n"),
  );

  watch(
    () => [invitePushIngestFingerprint.value, session.value?.actor],
    () => {
      const meId = sessionActorIdForInvites(session.value);
      if (!meId) return;
      let added = false;
      for (const o of invitePushObjects.value) {
        const v = o.value;
        if (!v || v.activity !== "Invite" || v.type !== "ChatInvite") continue;
        const targetId = normalizeInviteToActorId(v.inviteToActor);
        if (!targetId || targetId !== meId) continue;
        const cid = String(v.channel || "").trim();
        if (!isValidChatChannelId(cid)) continue;
        if (isPushInviteChannelDismissed(allDismissedPushInvites.value, session.value, cid)) continue;
        const known = getCurrentUserKnownChats(allKnownChats.value, session.value);
        if (known.some((c) => c.channel === cid)) continue;
        addPendingInvite(allPendingInvites.value, session.value, cid, {
          chatTitle: String(v.chatTitle || "").trim(),
        });
        added = true;
      }
      if (added) {
        allPendingInvites.value = loadAllPendingInvites();
      }
    },
    { immediate: true },
  );

  const pendingInvitesDisplay = computed(() => {
    const meId = sessionActorIdForInvites(session.value);
    const list = getPendingInvitesForUser(allPendingInvites.value, session.value);
    return list.map((p) => {
      let fromPush = String(p.inviteTitle || "").trim();
      if (!fromPush && meId) {
        for (const o of invitePushObjects.value) {
          const v = o.value;
          if (!v || v.activity !== "Invite" || v.type !== "ChatInvite") continue;
          if (String(v.channel || "").trim() !== p.channel) continue;
          if (normalizeInviteToActorId(v.inviteToActor) !== meId) continue;
          fromPush = String(v.chatTitle || "").trim();
          if (fromPush) break;
        }
      }
      return {
        ...p,
        title:
          fromPush ||
          effectiveChatTitle(chats.value, p.channel) ||
          lookupKnownChatTitle(session.value, p.channel) ||
          "Chat invitation",
      };
    });
  });

  const joinedChatsList = computed(() => {
    const pendingSet = new Set(
      getPendingInvitesForUser(allPendingInvites.value, session.value).map((x) => x.channel),
    );
    return knownChats.value.filter((c) => !pendingSet.has(c.channel));
  });

  const hasNoJoinedOrPending = computed(
    () => pendingInvitesDisplay.value.length === 0 && joinedChatsList.value.length === 0,
  );

  const globalChats = computed(() =>
    chats.value.filter(
      (chat) => chat.value.activity === "Create" && chat.value.type === "Chat" && !chat.value.private,
    ),
  );

  const chatCreateByChannel = computed(() => {
    const byChannel = new Map();
    for (const chat of chats.value) {
      if (chat.value?.activity !== "Create" || chat.value?.type !== "Chat") continue;
      const cid = String(chat.value.channel || "").trim();
      if (!cid) continue;
      byChannel.set(cid, chat);
    }
    return byChannel;
  });

  const globalMessageChannels = computed(() =>
    globalChats.value.map((c) => c.value.channel).filter((id) => Boolean(id && String(id).trim())),
  );

  /** Match chat message schema enough that join/leave pings validate (needed for accurate lobby occupancy). */
  const messagePresenceSchema = {
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

  const { objects: globalPresenceMessages, poll: pollGlobalPresence } = useGraffitiDiscover(
    () => (session.value && globalMessageChannels.value.length ? globalMessageChannels.value : []),
    messagePresenceSchema,
  );

  watch(
    globalMessageChannels,
    () => {
      void pollGlobalPresence();
    },
    { flush: "post" },
  );

  function normalizePartyupActor(actor) {
    if (actor == null) return "";
    return String(actor).trim();
  }

  const globalChatOccupancy = computed(() => {
    const occ = new Map();
    for (const chat of globalChats.value) {
      const cid = chat.value.channel;
      if (!cid) continue;
      const msgs = globalPresenceMessages.value.filter((m) => m.channels?.[0] === cid);
      const rawPresent = presentParticipantActorSet(chat, msgs);
      const banned = new Set(effectiveBannedActors(chats.value, cid));
      const normalized = new Set();
      for (const a of rawPresent) {
        const id = normalizePartyupActor(a);
        if (id && !banned.has(id)) normalized.add(id);
      }
      occ.set(cid, normalized);
    }
    return occ;
  });

  function isGlobalChatFull(chat) {
    const cid = chat.value.channel;
    if (!cid) return false;
    const max = effectiveMaxPlayers(chats.value, cid);
    const n = globalChatOccupancy.value.get(cid)?.size ?? 0;
    return n >= max;
  }

  function globalChatDisplayTitleBase(chat) {
    const cid = String(chat?.value?.channel || "").trim();
    return (
      (cid && effectiveChatTitle(chats.value, cid)) ||
      String(chat?.value?.title || "").trim() ||
      "Chat"
    );
  }

  /** Parenthetical segment: (owner, game label, full) — comma-separated, lowercase status tokens where noted. */
  function isGlobalChatClosedToJoin(chat) {
    const cid = chat?.value?.channel;
    if (!cid) return false;
    return isGlobalChatFull(chat) && !effectiveSpectatingEnabled(chats.value, cid);
  }

  function globalChatDisplayTitleWithSpectating(chat) {
    const base = globalChatDisplayTitleBase(chat);
    const cid = String(chat?.value?.channel || "").trim();
    const me = session.value?.actor;
    if (!cid || !me || !effectiveSpectatingEnabled(chats.value, cid)) return base;
    if (!isGlobalChatFull(chat)) return base;
    const meId = normalizePartyupActor(me);
    if (meId && globalChatOccupancy.value.get(cid)?.has(meId)) return base;
    const row = knownChats.value.find((c) => c.channel === cid);
    if (row?.spectator) return base;
    return `${base} [Spectating Enabled]`;
  }

  function globalChatPublicMetaSuffix(chat) {
    const cid = String(chat?.value?.channel || "").trim();
    const parts = [];
    if (isOwnedGlobalChat(chat)) parts.push("Owner");
    if (cid) {
      const gl = formatPublicChatGameLabel(effectiveGame(chats.value, cid));
      if (gl) parts.push(gl);
    }
    if (isGlobalChatFull(chat)) parts.push("full");
    if (!parts.length) return "";
    return ` (${parts.join(", ")})`;
  }

  function isOwnedChatChannel(channel) {
    const cid = String(channel || "").trim();
    const me = session.value?.actor;
    if (!cid || !me) return false;
    return chatCreateByChannel.value.get(cid)?.actor === me;
  }

  function isOwnedGlobalChat(chat) {
    return isOwnedChatChannel(chat?.value?.channel);
  }

  function goToChat(channel) {
    const id = channel?.trim();
    if (!id) return;
    router.push({ name: "chat", params: { chatId: id } });
  }

  function openCreateChatModal() {
    showCreateChatModal.value = true;
  }

  function closeCreateChatModal() {
    if (isRandomizing.value) return;
    showCreateChatModal.value = false;
  }

  async function newChat() {
    if (!session.value) return;
    const newChannel = crypto.randomUUID();
    isRandomizing.value = true;
    try {
      const playersCap = clampPlayerCap(chatPlayers.value);
      const resolvedGame =
        chatGame.value === "Other"
          ? chatOtherGameDetail.value.trim() || "Other"
          : chatGame.value;
      await graffiti.post(
        {
          value: {
            activity: "Create",
            type: "Chat",
            channel: newChannel,
            title: chatTitle.value.trim(),
            players: playersCap,
            game: resolvedGame,
            private: chatPrivacy.value,
            published: Date.now(),
            spectatingEnabled: false,
            enabledGameTools: [...defaultEnabledGameToolsForGame(resolvedGame)],
          },
          channels: ["partyup-26"],
        },
        session.value,
      );
      addKnownChat({
        channel: newChannel,
        title: chatTitle.value.trim(),
        players: playersCap,
        game: resolvedGame,
      });
      chatTitle.value = "";
      chatPlayers.value = 1;
      chatPrivacy.value = false;
      chatGame.value = PARTYUP_GAME_OPTIONS[0].value;
      chatOtherGameDetail.value = "";
      showCreateChatModal.value = false;
      goToChat(newChannel);
    } finally {
      isRandomizing.value = false;
    }
  }

  function changeChat(chat) {
    if (isGlobalChatClosedToJoin(chat)) return;
    addKnownChat({
      channel: chat.value.channel,
      title: chat.value.title,
      players: chat.value.players,
      game: chat.value.game,
    });
    goToChat(chat.value.channel);
  }

  function openKnownChat(chat) {
    goToChat(chat.channel);
  }

  function acceptPendingInvite(inv) {
    const id = inv?.channel?.trim();
    if (!id || !session.value) return;
    clearDismissedPushInviteChannel(allDismissedPushInvites.value, session.value, id);
    removePendingInvite(allPendingInvites.value, session.value, id);
    allPendingInvites.value = loadAllPendingInvites();
    persistKnownChat(allKnownChats.value, session.value, {
      channel: id,
      title:
        inv.title && inv.title !== "Chat invitation"
          ? inv.title
          : lookupKnownChatTitle(session.value, id) || "Known Chat",
    });
    allKnownChats.value = loadAllKnownChats();
    goToChat(id);
  }

  function declinePendingInvite(inv) {
    const id = inv?.channel?.trim();
    if (!id || !session.value) return;
    dismissPushInviteChannel(allDismissedPushInvites.value, session.value, id);
    removePendingInvite(allPendingInvites.value, session.value, id);
    allPendingInvites.value = loadAllPendingInvites();
  }

  function joinKnownChat() {
    const extracted = extractChatIdFromInviteInput(knownChatId.value);
    if (!extracted || !isValidChatChannelId(extracted)) return;
    addKnownChat({ channel: extracted });
    knownChatId.value = "";
    goToChat(extracted);
  }

  const canJoinKnownChat = computed(() => {
    const extracted = extractChatIdFromInviteInput(knownChatId.value);
    return Boolean(extracted && isValidChatChannelId(extracted));
  });

  return {
    showCreateChatModal,
    openCreateChatModal,
    closeCreateChatModal,
    newChat,
    globalChats,
    changeChat,
    openKnownChat,
    joinKnownChat,
    chatTitle,
    chatPlayers,
    chatPrivacy,
    chatGame,
    chatOtherGameDetail,
    knownChatId,
    canJoinKnownChat,
    knownChats,
    pendingInvitesDisplay,
    joinedChatsList,
    hasNoJoinedOrPending,
    acceptPendingInvite,
    declinePendingInvite,
    isRandomizing,
    PARTYUP_GAME_OPTIONS,
    PARTYUP_MAX_PLAYERS,
    isGlobalChatFull,
    isGlobalChatClosedToJoin,
    globalChatDisplayTitleBase,
    globalChatDisplayTitleWithSpectating,
    globalChatPublicMetaSuffix,
    isOwnedChatChannel,
    isOwnedGlobalChat,
  };
}

export default async () => ({
  setup,
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
