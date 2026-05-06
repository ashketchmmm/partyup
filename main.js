import { createApp, computed, ref, watch, onBeforeUnmount } from "vue";
import { createRouter, createWebHashHistory, useRoute } from "vue-router";
import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import { GraffitiPlugin, useGraffitiSession } from "@graffiti-garden/wrapper-vue";
import { lookupKnownChatTitle } from "./shared/known-chats.js";
import { headerChatLivePlayers } from "./shared/header-chat-live.js";

function loadComponent(name) {
  return () => import(`./${name}/main.js`).then((m) => m.default());
}

const HomeLayout = () => import("./home/layout.js").then((m) => m.default);

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: { name: "home" } },
    {
      path: "/home",
      component: HomeLayout,
      children: [
        { path: "", name: "home", component: loadComponent("home") },
        { path: "profile", name: "profile", component: loadComponent("profile") },
      ],
    },
    { path: "/profile", redirect: "/home/profile" },
    { path: "/chat/:chatId", name: "chat", component: loadComponent("chat"), props: true },
  ],
});

const app = createApp({
  template: "#template",
  setup() {
    const route = useRoute();
    const session = useGraffitiSession();

    const isChatRoute = computed(() => route.name === "chat" && Boolean(route.params.chatId));

    const showHomeNav = computed(
      () => Boolean(session.value) && route.name !== "chat",
    );

    const headerTitle = computed(() => {
      const id = route.params.chatId;
      if (!id || route.name !== "chat") return "PartyUp";
      const sid = String(id);
      const live = headerChatLivePlayers.value;
      const storedTitle = lookupKnownChatTitle(session.value, sid);
      const label =
        live?.channel === sid && live.title ? live.title : (storedTitle || "Chat");
      const players = live?.channel === sid ? live.inRoom : null;
      return `${label} | Players Online: ${players ?? "?"}`;
    });

    const displayedChatTitle = ref("");
    let typingTimer = null;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function clearTypingTimer() {
      if (typingTimer !== null) {
        clearTimeout(typingTimer);
        typingTimer = null;
      }
    }

    function scheduleTypingTick() {
      clearTypingTimer();
      const tick = () => {
        const goal = headerTitle.value;
        if (route.name !== "chat") return;
        let cur = displayedChatTitle.value;
        if (goal.startsWith(cur) && cur.length < goal.length) {
          displayedChatTitle.value = goal.slice(0, cur.length + 1);
          typingTimer = setTimeout(tick, 15 + Math.floor(Math.random() * 36));
        } else if (!goal.startsWith(cur)) {
          displayedChatTitle.value = "";
          typingTimer = setTimeout(tick, 15 + Math.floor(Math.random() * 36));
        } else {
          typingTimer = null;
        }
      };
      tick();
    }

    watch(
      () => ({
        onChat: route.name === "chat" && Boolean(route.params.chatId),
        chatId: String(route.params.chatId ?? ""),
        full: headerTitle.value,
      }),
      (state, prev) => {
        clearTypingTimer();
        if (!state.onChat) {
          displayedChatTitle.value = "";
          return;
        }
        if (reduceMotion) {
          displayedChatTitle.value = state.full;
          return;
        }

        const switchedChat = !prev?.onChat || prev.chatId !== state.chatId;
        if (switchedChat) {
          displayedChatTitle.value = "";
          scheduleTypingTick();
          return;
        }

        if (prev && state.full !== prev.full) {
          const prevGoal = prev.full;
          if (displayedChatTitle.value.length >= prevGoal.length && displayedChatTitle.value === prevGoal) {
            displayedChatTitle.value = state.full;
          } else {
            scheduleTypingTick();
          }
        }
      },
      { immediate: true },
    );

    onBeforeUnmount(() => {
      clearTypingTimer();
    });

    return { isChatRoute, showHomeNav, headerTitle, displayedChatTitle };
  },
});

app.use(router);

app.use(GraffitiPlugin, {
  graffiti: new GraffitiDecentralized(),
});

app.mount("#app");
