function initialsFromName(name) {
  const n = (name || "").trim();
  if (!n) return "?";
  return n.slice(0, 2).toUpperCase();
}

/** Circular avatar: image URL or two-letter initials fallback. */
export const UserAvatar = {
  name: "UserAvatar",
  props: {
    name: { type: String, default: "User" },
    imageUrl: { type: String, default: "" },
    size: {
      type: String,
      default: "default",
      validator: (v) => ["default", "small", "large"].includes(v),
    },
    /** When true, root is a button and emits click. */
    clickable: { type: Boolean, default: false },
    /** Overrides alt text for the image (defaults from name). */
    alt: { type: String, default: "" },
  },
  emits: ["click"],
  computed: {
    displayAlt() {
      return (this.alt || this.name || "User").trim() || "avatar";
    },
    trimmedImage() {
      return (this.imageUrl || "").trim();
    },
    initials() {
      return initialsFromName(this.name);
    },
    rootClass() {
      const classes = ["message-avatar"];
      if (this.size === "small") classes.push("small");
      if (this.size === "large") classes.push("profile-page-avatar");
      if (this.clickable) classes.push("avatar-button");
      return classes;
    },
  },
  methods: {
    onClick(e) {
      if (this.clickable) this.$emit("click", e);
    },
  },
  template: `
    <button v-if="clickable" type="button" :class="rootClass" @click="onClick">
      <img v-if="trimmedImage" :src="trimmedImage" :alt="displayAlt" />
      <span v-else>{{ initials }}</span>
    </button>
    <div v-else :class="rootClass">
      <img v-if="trimmedImage" :src="trimmedImage" :alt="displayAlt" />
      <span v-else>{{ initials }}</span>
    </div>
  `,
};
