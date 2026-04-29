import { createApp, computed } from "vue";
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

    return { isChatRoute, showHomeNav, headerTitle };
  },
});

app.use(router);

app.use(GraffitiPlugin, {
  graffiti: new GraffitiDecentralized(),
});

app.mount("#app");
