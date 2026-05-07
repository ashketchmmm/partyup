/**
 * Rulebook entry points per PartyUp game preset (matches chat-meta PARTYUP_GAME_OPTIONS values).
 * Replace URLs with your own PDFs or official references — opened in a new tab or in-app viewer.
 */
export const RULEBOOK_URL_BY_GAME = Object.freeze({
  "D&D": "https://media.wizards.com/2018/dnd/downloads/DnD_BasicRules_2018.pdf",
  Catan: "https://www.catan.com/sites/default/files/2021-06/catan_base_rules_2020_200707.pdf",
  BoTC: "https://www.web3us.com/sites/default/files/Rulebook.pdf",
  Pathfinder: "https://www.d20pfsrd.com/wp-content/uploads/sites/12/2017/01/PFRPG_SRD.pdf",
  Other: "https://www.google.com/search?q=rulebook+for+<game name>",
});

/**
 * Resolves a rulebook URL for the effective game string stored on the chat (preset or custom "Other" title).
 */
export function resolveRulebookUrl(gameDisplayName) {
  const g = (gameDisplayName || "").trim();
  if (!g) return null;
  if (Object.prototype.hasOwnProperty.call(RULEBOOK_URL_BY_GAME, g)) {
    return RULEBOOK_URL_BY_GAME[g];
  }
  const lower = g.toLowerCase();
  for (const [key, url] of Object.entries(RULEBOOK_URL_BY_GAME)) {
    if (key.toLowerCase() === lower) return url;
  }
  return null;
}
