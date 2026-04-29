import { ref, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { useGraffiti, useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";
import {
  loadAllKnownChats,
  getCurrentUserKnownChats,
  addKnownChat as persistKnownChat,
} from "../shared/known-chats.js";

function setup() {
  const router = useRouter();
  const graffiti = useGraffiti();
  const session = useGraffitiSession();

  const isRandomizing = ref(false);
  const chatTitle = ref("");
  const chatPlayers = ref(1);
  const chatPrivacy = ref(false);
  const knownChatId = ref("");
  const allKnownChats = ref(loadAllKnownChats());

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

  const { objects: chats } = useGraffitiDiscover(
    () => (session.value ? ["partyup-26"] : []),
    {
      properties: {
        value: {
          required: ["activity", "type", "channel", "title", "published"],
          properties: {
            activity: { const: "Create" },
            type: { const: "Chat" },
            channel: { type: "string" },
            title: { type: "string" },
            players: { type: "number" },
            private: { type: "boolean" },
            published: { type: "number" },
          },
        },
      },
    },
  );

  const globalChats = computed(() => chats.value.filter((chat) => !chat.value.private));

  function goToChat(channel) {
    const id = channel?.trim();
    if (!id) return;
    router.push({ name: "chat", params: { chatId: id } });
  }

  async function newChat() {
    if (!session.value) return;
    const newChannel = crypto.randomUUID();
    isRandomizing.value = true;
    try {
      await graffiti.post(
        {
          value: {
            activity: "Create",
            type: "Chat",
            channel: newChannel,
            title: chatTitle.value,
            players: chatPlayers.value,
            private: chatPrivacy.value,
            published: Date.now(),
          },
          channels: ["partyup-26"],
        },
        session.value,
      );
      addKnownChat({
        channel: newChannel,
        title: chatTitle.value,
        players: chatPlayers.value,
      });
      chatTitle.value = "";
      chatPlayers.value = 1;
      chatPrivacy.value = false;
      goToChat(newChannel);
    } finally {
      isRandomizing.value = false;
    }
  }

  function changeChat(chat) {
    addKnownChat({
      channel: chat.value.channel,
      title: chat.value.title,
      players: chat.value.players,
    });
    goToChat(chat.value.channel);
  }

  function openKnownChat(chat) {
    goToChat(chat.channel);
  }

  function joinKnownChat() {
    const trimmedChatId = knownChatId.value.trim();
    if (!trimmedChatId) return;
    addKnownChat({ channel: trimmedChatId });
    knownChatId.value = "";
    goToChat(trimmedChatId);
  }

  return {
    newChat,
    globalChats,
    changeChat,
    openKnownChat,
    joinKnownChat,
    chatTitle,
    chatPlayers,
    chatPrivacy,
    knownChatId,
    knownChats,
    isRandomizing,
  };
}

export default async () => ({
  setup,
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
