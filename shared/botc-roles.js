/**
 * Blood on the Clocktower — role reference for General Tools (paraphrased summaries).
 * Teams match user-facing labels: Townsfolk, Outsiders, Minions, Imp (demon).
 */

/** @typedef {'townsfolk' | 'outsiders' | 'minions' | 'demon'} PartyupBotcTeam */

/** @type {{ id: string; name: string; team: PartyupBotcTeam; blurb: string }[]} */
export const PARTYUP_BOTC_ROLES = [
  // Trouble Brewing — Townsfolk
  {
    id: "tb-washerwoman",
    name: "Washerwoman",
    team: "townsfolk",
    blurb: "Starts knowing that one of two players is a particular Townsfolk character.",
  },
  {
    id: "tb-librarian",
    name: "Librarian",
    team: "townsfolk",
    blurb: "Starts knowing that one of two players is a particular Outsider—or that zero are in play.",
  },
  {
    id: "tb-investigator",
    name: "Investigator",
    team: "townsfolk",
    blurb: "Starts knowing that one of two players is a particular Minion.",
  },
  {
    id: "tb-chef",
    name: "Chef",
    team: "townsfolk",
    blurb: "Learns how many pairs of evil neighbours there are.",
  },
  {
    id: "tb-empath",
    name: "Empath",
    team: "townsfolk",
    blurb: "Learns how many of their two living neighbours are evil (not how many are good).",
  },
  {
    id: "tb-fortune-teller",
    name: "Fortune Teller",
    team: "townsfolk",
    blurb: "Each night, chooses two players and learns if the Demon is among them; one player is a red herring.",
  },
  {
    id: "tb-undertaker",
    name: "Undertaker",
    team: "townsfolk",
    blurb: "Learns which character was executed today—if someone died by execution.",
  },
  {
    id: "tb-monk",
    name: "Monk",
    team: "townsfolk",
    blurb: "Each night (but not the first), chooses someone other than themself: they cannot die by the Demon that night.",
  },
  {
    id: "tb-ravenkeeper",
    name: "Ravenkeeper",
    team: "townsfolk",
    blurb: "If the Demon kills them at night, they wake to choose a player: they learn that player’s character.",
  },
  {
    id: "tb-virgin",
    name: "Virgin",
    team: "townsfolk",
    blurb: "The first time they are nominated, if the nominator is a Townsfolk, that player is executed immediately.",
  },
  {
    id: "tb-slayer",
    name: "Slayer",
    team: "townsfolk",
    blurb: "Once per game, while alive, may publicly choose someone: if they are the Demon, they die.",
  },
  {
    id: "tb-soldier",
    name: "Soldier",
    team: "townsfolk",
    blurb: "Cannot die from the Demon’s ability.",
  },
  {
    id: "tb-mayor",
    name: "Mayor",
    team: "townsfolk",
    blurb: "If only three players live and no execution occurs, good wins. May secretly redirect a kill to another player.",
  },
  // Trouble Brewing — Outsiders
  {
    id: "tb-butler",
    name: "Butler",
    team: "outsiders",
    blurb: "Votes only if their master (chosen first night) votes; both must be alive.",
  },
  {
    id: "tb-drunk",
    name: "Drunk",
    team: "outsiders",
    blurb: "Thinks they are a Townsfolk but is actually drunk; they malfunction while they believe that Townsfolk role.",
  },
  {
    id: "tb-recluse",
    name: "Recluse",
    team: "outsiders",
    blurb: "May register as evil to good abilities even though they are good.",
  },
  {
    id: "tb-saint",
    name: "Saint",
    team: "outsiders",
    blurb: "If they die by execution, good loses.",
  },
  // Trouble Brewing — Minions
  {
    id: "tb-poisoner",
    name: "Poisoner",
    team: "minions",
    blurb: "Each night, chooses someone: they are poisoned until next night; poisoned players malfunction.",
  },
  {
    id: "tb-spy",
    name: "Spy",
    team: "minions",
    blurb: "Sees the Grimoire (the night sheet). May register as good to Townsfolk abilities.",
  },
  {
    id: "tb-scarlet-woman",
    name: "Scarlet Woman",
    team: "minions",
    blurb: "If there are five or more alive when the Demon dies, she becomes the Demon.",
  },
  {
    id: "tb-baron",
    name: "Baron",
    team: "minions",
    blurb: "Setup: two Outsiders replace two Townsfolk.",
  },
  // Trouble Brewing — Demon
  {
    id: "tb-imp",
    name: "Imp",
    team: "demon",
    blurb: "Each night (but not the first), chooses someone: they die. If they die by execution, a Minion becomes the Imp.",
  },
  // Sects & Violets — sample roles (same team structure)
  {
    id: "sv-clockmaker",
    name: "Clockmaker",
    team: "townsfolk",
    blurb: "Starts knowing how many steps from the Demon to a Minion (clockwise).",
  },
  {
    id: "sv-dreamer",
    name: "Dreamer",
    team: "townsfolk",
    blurb: "Each night, chooses a player (not themself): learns a character that player is one of two.",
  },
  {
    id: "sv-savant",
    name: "Savant",
    team: "townsfolk",
    blurb: "Each day, privately learns two true statements from the Storyteller.",
  },
  {
    id: "sv-mutant",
    name: "Mutant",
    team: "outsiders",
    blurb: "If they are mad about being an Outsider and are executed, good loses.",
  },
  {
    id: "sv-evil-twin",
    name: "Evil Twin",
    team: "minions",
    blurb: "Setup: pairs with a good player; they register as each other’s characters to good abilities.",
  },
  {
    id: "sv-fang-gu",
    name: "Fang Gu",
    team: "demon",
    blurb: "When they kill an Outsider, they swap seats with them and that player becomes evil.",
  },
];

export function partyupBotcTeamLabel(team) {
  switch (team) {
    case "townsfolk":
      return "Townsfolk";
    case "outsiders":
      return "Outsiders";
    case "minions":
      return "Minions";
    case "demon":
      return "Imp";
    default:
      return team || "";
  }
}
