import { createApp, computed } from "vue";
import { createRouter, createWebHashHistory, useRoute } from "vue-router";
import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import { GraffitiPlugin, useGraffitiSession } from "@graffiti-garden/wrapper-vue";
import { lookupKnownChatTitle, lookupKnownChatPlayers } from "./shared/known-chats.js";

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
      const title = lookupKnownChatTitle(session.value, String(id));
      const label = title || "Chat";
      const players = lookupKnownChatPlayers(session.value, String(id));
      return `${label} | Players: ${players ?? "?"}`;
    });

    return { isChatRoute, showHomeNav, headerTitle };
  },
});

app.use(router);

app.use(GraffitiPlugin, {
  graffiti: new GraffitiDecentralized(),
});

app.mount("#app");
