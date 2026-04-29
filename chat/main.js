import { ref, computed, watch, toRef } from "vue";
import { useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import { lookupKnownChatTitle, lookupKnownChatPlayers } from "../shared/known-chats.js";
import { getMainProfile } from "../shared/main-profile.js";

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

  function profileInitials(profileName) {
    if (!profileName) return "?";
    return profileName.trim().slice(0, 2).toUpperCase();
  }

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

  const currentChat = computed(() => {
    return chats.value.find((chat) => chat.value.channel === channel.value) ?? null;
  });

  const currentChatName = computed(() => {
    return (
      currentChat.value?.value.title ??
      lookupKnownChatTitle(session.value, channel.value) ??
      "Known Chat"
    );
  });

  const currentChatPlayers = computed(() => {
    return (
      currentChat.value?.value.players ??
      lookupKnownChatPlayers(session.value, channel.value) ??
      "Unknown"
    );
  });

  function leaveChat() {
    myMessage.value = "";
    privateMessageTarget.value = null;
    showGameOverlay.value = false;
    showChatOverlay.value = false;
    showPlayersDropdown.value = false;
    showProfileMenu.value = false;
    router.push({ name: "home" });
  }

  function openGameOverlay() {
    showGameOverlay.value = true;
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
    profileInitials,
  };
}

export default async () => ({
  props: ["chatId"],
  setup: chatSetup,
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
