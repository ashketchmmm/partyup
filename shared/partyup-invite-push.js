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
