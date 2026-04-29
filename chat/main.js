import { ref, computed, watch, toRef } from "vue";
import { useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import {
  lookupKnownChatTitle,
  lookupKnownChatPlayers,
  addKnownChat,
  loadAllKnownChats,
} from "../shared/known-chats.js";
import {
  PARTYUP_GAME_OPTIONS,
  createForChannel,
  effectiveMaxPlayers,
  effectiveGame,
  participantActorSet as buildParticipantActorSet,
} from "../shared/chat-meta.js";
import { getMainProfile } from "../shared/main-profile.js";
import { UserAvatar } from "../components/user-avatar.js";

const profilesStorageKey = "partyup-chat-profiles";

function chatSetup(props) {
  const router = useRouter();
  const graffiti = useGraffiti();
  const session = useGraffitiSession();
  const chatIdRef = toRef(props, "chatId");

  const showGameOverlay = ref(false);
  const showChatOverlay = ref(false);
  const showPlayersDropdown = ref(false);
  const allUserProfiles = ref(loadAllUserProfiles());
  const showProfileMenu = ref(false);
  const newProfileName = ref("");
  const newProfileAvatar = ref("");
  const privateMessageTarget = ref(null);
  const sendError = ref("");

  const channel = computed(() => (chatIdRef.value || "").trim());

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

  function selectProfile(profileId) {
    const profileState = currentProfileState.value;
    if (!profileState) return;
    if (!profileState.profiles.some((profile) => profile.id === profileId)) return;
    profileState.selectedProfileId = profileId;
    saveAllUserProfiles();
    showProfileMenu.value = false;
  }

  function createProfile() {
    const profileState = currentProfileState.value;
    if (!profileState) return;
    const trimmedName = newProfileName.value.trim();
    if (!trimmedName) return;
    const newProfile = {
      id: crypto.randomUUID(),
      name: trimmedName,
      avatar: newProfileAvatar.value.trim(),
    };
    profileState.profiles.unshift(newProfile);
    profileState.selectedProfileId = newProfile.id;
    newProfileName.value = "";
    newProfileAvatar.value = "";
    saveAllUserProfiles();
  }

  function removeProfile(profileId) {
    const profileState = currentProfileState.value;
    if (!profileState || profileState.profiles.length <= 1) return;
    profileState.profiles = profileState.profiles.filter((profile) => profile.id !== profileId);
    if (!profileState.profiles.some((profile) => profile.id === profileState.selectedProfileId)) {
      profileState.selectedProfileId = profileState.profiles[0]?.id ?? null;
    }
    saveAllUserProfiles();
  }

  function toggleProfileMenu() {
    showProfileMenu.value = !showProfileMenu.value;
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
    return (
      currentChat.value?.value.title ??
      lookupKnownChatTitle(session.value, channel.value) ??
      "Known Chat"
    );
  });

  const maxPlayersEffective = computed(() =>
    channel.value ? effectiveMaxPlayers(chats.value, channel.value) : 1,
  );

  const currentChatGame = computed(() =>
    channel.value ? effectiveGame(chats.value, channel.value) : "Other",
  );

  const currentChatPlayers = computed(() => maxPlayersEffective.value);

  function persistKnownChatForCurrentChannel() {
    const ch = channel.value;
    const ses = session.value;
    if (!ch || !ses?.actor) return;
    const all = loadAllKnownChats();
    addKnownChat(all, ses, {
      channel: ch,
      title: lookupKnownChatTitle(ses, ch) || "Known Chat",
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
      if (!url || !channel.value || !session.value?.actor) return;
      const v = currentChat.value?.value;
      if (!v || v.channel !== channel.value) return;
      const all = loadAllKnownChats();
      addKnownChat(all, session.value, {
        channel: channel.value,
        title: String(v.title || "").trim() || "Known Chat",
        players: typeof v.players === "number" ? v.players : null,
        game: v.game,
      });
    },
  );

  function leaveChat() {
    myMessage.value = "";
    privateMessageTarget.value = null;
    showGameOverlay.value = false;
    showChatOverlay.value = false;
    showPlayersDropdown.value = false;
    showProfileMenu.value = false;
    router.push({ name: "home" });
  }

  const settingsGame = ref(PARTYUP_GAME_OPTIONS[0].value);
  const settingsMaxPlayers = ref(1);
  const settingsSaveError = ref("");

  function openGameOverlay() {
    settingsSaveError.value = "";
    const allowedGames = new Set(PARTYUP_GAME_OPTIONS.map((o) => o.value));
    const g = currentChatGame.value;
    settingsGame.value = allowedGames.has(g) ? g : "Other";
    settingsMaxPlayers.value = maxPlayersEffective.value;
    showGameOverlay.value = true;
  }

  async function saveGameSettings() {
    if (!session.value || !channel.value || !isChatCreator.value) return;
    settingsSaveError.value = "";
    const cap = Math.max(1, Math.floor(Number(settingsMaxPlayers.value)) || 1);
    if (cap < participantCount.value) {
      settingsSaveError.value = `Limit must be at least ${participantCount.value} (players already in this chat).`;
      return;
    }
    try {
      await graffiti.post(
        {
          value: {
            activity: "Update",
            type: "Chat",
            channel: channel.value,
            players: cap,
            game: settingsGame.value,
            published: Date.now(),
          },
          channels: ["partyup-26"],
        },
        session.value,
      );
      closeOverlays();
    } catch (error) {
      console.error(error);
      settingsSaveError.value = error?.message || "Could not save settings.";
    }
  }

  function openChatOverlay() {
    showChatOverlay.value = true;
  }

  function closeOverlays() {
    showGameOverlay.value = false;
    showChatOverlay.value = false;
  }

  function togglePlayersDropdown() {
    showPlayersDropdown.value = !showPlayersDropdown.value;
  }

  const myMessage = ref("");

  const { objects: messageObjects, isFirstPoll: areMessageObjectsLoading } = useGraffitiDiscover(
    () => (session.value && channel.value ? [channel.value] : []),
    {
      properties: {
        value: {
          required: ["content", "published"],
          properties: {
            content: { type: "string" },
            published: { type: "number" },
          },
        },
      },
    },
    undefined,
    true,
  );

  const participantActors = computed(() =>
    buildParticipantActorSet(currentChat.value, messageObjects.value),
  );

  const participantCount = computed(() => participantActors.value.size);

  const currentUserIsParticipant = computed(
    () => Boolean(session.value?.actor && participantActors.value.has(session.value.actor)),
  );

  const joinBlocked = computed(() => {
    if (!channel.value || !session.value?.actor) return false;
    if (!currentChat.value) return false;
    if (currentUserIsParticipant.value) return false;
    return participantCount.value >= maxPlayersEffective.value;
  });

  const isChatCreator = computed(
    () =>
      Boolean(
        session.value?.actor &&
          currentChat.value?.actor &&
          session.value.actor === currentChat.value.actor,
      ),
  );

  const settingsMinPlayers = computed(() => Math.max(1, participantCount.value));

  const sortedMessageObjects = computed(() => {
    return messageObjects.value.toSorted((a, b) => {
      return a.value.published - b.value.published;
    });
  });

  const actorProfileDirectory = computed(() => {
    const directory = new Map();
    for (const messageObject of messageObjects.value) {
      const actorId = messageObject.actor;
      if (!actorId) continue;
      directory.set(actorId, {
        actor: actorId,
        name: messageObject.value.profileName || "Unknown user",
        avatar: messageObject.value.profileAvatar || "",
      });
    }
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

  const visibleMessageObjects = computed(() => {
    const currentActor = session.value?.actor;
    return sortedMessageObjects.value.filter((messageObject) => {
      const privateToActor = messageObject.value.privateToActor;
      if (!privateToActor) return true;
      return messageObject.actor === currentActor || privateToActor === currentActor;
    });
  });

  const otherUsersInChat = computed(() => {
    const currentActor = session.value?.actor;
    const uniqueUsers = new Map();
    for (const messageObject of messageObjects.value) {
      if (messageObject.actor && messageObject.actor !== currentActor) {
        const actorId = messageObject.actor;
        if (!uniqueUsers.has(actorId)) {
          uniqueUsers.set(actorId, {
            actor: actorId,
            name: messageObject.value.profileName || "Unknown user",
            avatar: messageObject.value.profileAvatar || "",
          });
        }
      }
    }
    return [...uniqueUsers.values()];
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
    if (messageObject.actor === session.value?.actor) return;
    const nickname = messageObject.value.profileName || "User";
    setPrivateDraftTarget(messageObject.actor, nickname);
  }

  function onPlayerClick(user) {
    setPrivateDraftTarget(user.actor, user.name || "User");
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
    privateMessageTarget.value = { actor: resolvedActor, name: mentionData.nickname };
  }

  const isSending = ref(false);

  async function sendMessage() {
    if (!session.value || !channel.value) return;
    if (joinBlocked.value) return;
    const draftMessage = myMessage.value.trim();
    if (!draftMessage) return;
    sendError.value = "";

    const mentionData = extractPrivateMention(draftMessage);
    let messageContent = draftMessage;
    let privateToActor = null;
    let privateToNickname = null;
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
      } else {
        privateToActor = null;
        privateToNickname = null;
        messageContent = draftMessage;
      }
    }

    isSending.value = true;
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

      await graffiti.post(
        {
          value: messageValue,
          channels: [channel.value],
        },
        session.value,
      );
      myMessage.value = "";
      privateMessageTarget.value = null;
    } catch (error) {
      console.error("Failed to send message:", error);
      sendError.value = error?.message || "Failed to send message.";
    } finally {
      isSending.value = false;
    }
  }

  const isDeleting = ref(new Set());

  async function deleteMessage(message) {
    isDeleting.value.add(message.url);
    try {
      await graffiti.delete(message, session.value);
    } finally {
      isDeleting.value.delete(message.url);
    }
  }

  return {
    myMessage,
    areMessageObjectsLoading,
    visibleMessageObjects,
    isSending,
    sendMessage,
    isDeleting,
    deleteMessage,
    currentProfiles,
    activeProfile,
    currentChatName,
    currentChatPlayers,
    currentChatGame,
    participantCount,
    joinBlocked,
    isChatCreator,
    settingsGame,
    settingsMaxPlayers,
    settingsSaveError,
    saveGameSettings,
    PARTYUP_GAME_OPTIONS,
    settingsMinPlayers,
    channel,
    leaveChat,
    showGameOverlay,
    showChatOverlay,
    showPlayersDropdown,
    openGameOverlay,
    openChatOverlay,
    closeOverlays,
    togglePlayersDropdown,
    otherUsersInChat,
    privateMessageTarget,
    sendError,
    onProfileAvatarClick,
    onPlayerClick,
    handleMessageInput,
    showProfileMenu,
    newProfileName,
    newProfileAvatar,
    toggleProfileMenu,
    selectProfile,
    createProfile,
    removeProfile,
  };
}

export default async () => ({
  props: ["chatId"],
  components: { UserAvatar },
  setup: chatSetup,
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
