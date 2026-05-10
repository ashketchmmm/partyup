/**
 * Cross-user chat invites: objects on `partyup-26` so recipients see pending invites on the Lobby.
 */

/** JSON-schema fragment for useGraffitiDiscover on partyup-26. */
export const PARTYUP_INVITE_PUSH_SCHEMA = {
  properties: {
    value: {
      required: ["activity", "type", "channel", "inviteToActor", "published"],
      properties: {
        activity: { const: "Invite" },
        type: { const: "ChatInvite" },
        channel: { type: "string" },
        inviteToActor: { type: "string" },
        chatTitle: { type: "string" },
        published: { type: "number" },
      },
    },
  },
};

/**
 * Turns `ash` into `ash.graffiti.actor`. Leaves full handles (with a dot) as trimmed lowercase.
 */
export function normalizePartyupActorHandle(raw) {
  let s = String(raw ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (!s) return "";
  if (!s.includes(".")) {
    if (!/^[a-z0-9_-]+$/.test(s)) return "";
    return `${s}.graffiti.actor`;
  }
  return s;
}

/**
 * Canonical actor id for invites: short names / full handles via {@link normalizePartyupActorHandle},
 * plus opaque ids from coplay (`meta.actor`) that are not simple graffiti short names.
 */
export function normalizeInviteToActorId(raw) {
  let trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      trimmed = `${u.hostname}${u.pathname.replace(/\/$/, "")}`;
    } catch {
      /* keep trimmed */
    }
  }
  const fromHandle = normalizePartyupActorHandle(trimmed);
  if (fromHandle) return fromHandle;
  const lower = trimmed.toLowerCase();
  if (lower.includes(".")) return lower;
  // Opaque Graffiti actor tokens (often stored from message metadata)
  if (/^[a-zA-Z0-9_.:@-]+$/.test(trimmed)) return lower;
  return "";
}

/** Stable string for matching the logged-in user to `inviteToActor` on invite objects. */
export function sessionActorIdForInvites(session) {
  const raw = session?.actor;
  if (raw == null) return "";
  if (typeof raw === "string") return normalizeInviteToActorId(raw);
  if (typeof raw === "object") {
    for (const k of ["id", "actor", "handle", "username"]) {
      const v = raw[k];
      if (typeof v === "string" && v.trim()) return normalizeInviteToActorId(v);
    }
  }
  return normalizeInviteToActorId(String(raw));
}
