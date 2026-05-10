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

/** RFC 4122 UUID (chat channel ids, and some actor ids) — must not get `.graffiti.actor` suffix. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns `ash` into `ash.graffiti.actor`. Leaves full handles (with a dot) as trimmed lowercase.
 */
export function normalizePartyupActorHandle(raw) {
  let s = String(raw ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (!s) return "";
  if (UUID_RE.test(s)) return s;
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

/**
 * Graffiti session `actor` string (canonical id). Do not rewrite through handle normalization —
 * that can corrupt UUIDs and other opaque actor ids.
 */
export function sessionActorIdForInvites(session) {
  const raw = session?.actor;
  if (typeof raw === "string") {
    const s = raw.trim();
    return s.length > 0 ? s : "";
  }
  if (raw != null && typeof raw === "object") {
    for (const k of ["actor", "id", "handle", "username"]) {
      const v = raw[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
}

/** Sync-only: strict id match or normalized handle equality (legacy invites). */
export function inviteActorMatchesSessionSync(session, inviteToActorRaw) {
  const me = sessionActorIdForInvites(session);
  const inv = String(inviteToActorRaw ?? "").trim();
  if (!me || !inv) return false;
  if (inv === me) return true;
  const nInv = normalizeInviteToActorId(inv);
  const nMe = normalizeInviteToActorId(me);
  return Boolean(nInv && nMe && nInv === nMe);
}
