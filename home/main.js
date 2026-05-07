import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useGraffiti, useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";
import {
  loadAllKnownChats,
  getCurrentUserKnownChats,
  addKnownChat as persistKnownChat,
} from "../shared/known-chats.js";
import {
  PARTYUP_GAME_OPTIONS,
  PARTYUP_MAX_PLAYERS,
  effectiveMaxPlayers,
  clampPlayerCap,
} from "../shared/chat-meta.js";
import { extractChatIdFromInviteInput } from "../shared/chat-invite.js";

/** Graffiti chat channels are created with `crypto.randomUUID()` (RFC 4122 string form). */
const CHAT_ID_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidChatChannelId(id) {
  return typeof id === "string" && CHAT_ID_UUID_RE.test(id.trim());
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
      }
    },
    { immediate: true },
  );

  watch(
    () => router.currentRoute.value.name,
    (name) => {
      if (name === "home") {
        allKnownChats.value = loadAllKnownChats();
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
      addKnownChat({ channel: id });
      router.replace({ name: "chat", params: { chatId: id } });
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

  const globalChats = computed(() =>
    chats.value.filter(
      (chat) => chat.value.activity === "Create" && chat.value.type === "Chat" && !chat.value.private,
    ),
  );

  const globalMessageChannels = computed(() =>
    globalChats.value.map((c) => c.value.channel).filter((id) => Boolean(id && String(id).trim())),
  );

  const messagePresenceSchema = {
    properties: {
      value: {
        required: ["content", "published"],
        properties: {
          content: { type: "string" },
          published: { type: "number" },
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

  const globalChatOccupancy = computed(() => {
    const occ = new Map();
    for (const chat of globalChats.value) {
      const cid = chat.value.channel;
      if (!cid) continue;
      occ.set(cid, new Set());
      if (chat.actor) occ.get(cid).add(chat.actor);
    }
    for (const m of globalPresenceMessages.value) {
      const cid = m.channels?.[0];
      if (!cid || !occ.has(cid)) continue;
      if (m.actor) occ.get(cid).add(m.actor);
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
    if (isGlobalChatFull(chat)) return;
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
    isRandomizing,
    PARTYUP_GAME_OPTIONS,
    PARTYUP_MAX_PLAYERS,
    isGlobalChatFull,
  };
}

export default async () => ({
  setup,
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
