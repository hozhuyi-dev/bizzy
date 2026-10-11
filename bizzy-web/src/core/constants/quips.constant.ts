/**
 * The app's light touches: one short line picked at random above a plain
 * explanation, never instead of it. Deadpan, gently bee-themed, and never at
 * her expense. Kept out of money, errors and anything destructive.
 */
export const QUIPS = {
  loading: [
    "Gathering pollen…",
    "Warming up the hive…",
    "Counting the honey…",
    "Waking the bees…",
    "Fetching, at bee speed…",
    "Flapping as fast as we can…",
  ],
  sessionsTodo: [
    "All caught up. The hive is tidy.",
    "Nothing to buzz about.",
    "Wings off, feet up.",
    "Not a single loose end. Suspicious.",
    "The to-do list has left the building.",
    "Time for a honey break.",
  ],
  sessionsHistory: [
    "A quiet month in the hive.",
    "Not much buzz this month.",
    "The bees took this one off.",
    "Nothing in the calendar. Not even a maybe.",
    "Tumbleweeds, but bee-shaped.",
  ],
  clients: [
    "Every hive starts with one bee.",
    "The hive is waiting.",
    "Plenty of room in here.",
    "No bees yet. Just a very tidy hive.",
    "First client gets the best seat.",
  ],
  clientsFollowUp: [
    "Nobody's wandered off.",
    "Everyone's been buzzed.",
    "The whole hive is accounted for.",
    "No strays today.",
    "Everyone's coming back. Probably.",
  ],
  packages: [
    "The honey jar is empty.",
    "Not a drop of honey.",
    "No prepaid honey on the shelf.",
    "The jar's been licked clean.",
    "Nothing stocked up. Yet.",
  ],
  receipts: [
    "Not a receipt to bee seen.",
    "The paper trail starts here.",
    "The filing cabinet is very relaxed.",
    "No paperwork. Enjoy it while it lasts.",
    "Fresh out of receipts. Fresh in general.",
  ],
  insightsTopClients: [
    "No pollen collected this year.",
    "The leaderboard is wide open.",
    "Nobody's on the podium yet.",
    "Quiet year. The charts are napping.",
  ],
  // Placeholders: short enough for the box, and hinting words mix and match.
  searchPlaceholder: [
    "Buzz me a name…",
    "Try “jane oct”…",
    "What are we after?",
    "Names, dates, amounts…",
    "Sniff out a row…",
  ],
  search: [
    "Nothing buzzing for that.",
    "The bees came back empty-handed.",
    "Searched the whole hive.",
    "Not a flower in sight.",
  ],
  contactSearch: [
    "No bee by that name.",
    "Nobody buzzing under that name.",
    "The hive doesn't know them.",
    "Checked every cell. Nothing.",
  ],
  notFound: [
    "This page flew off.",
    "Buzz… nothing here.",
    "This page went to find better flowers.",
    "The bee checked. Twice. Nothing.",
    "Even the bees can't find this one.",
  ],
} as const satisfies Record<string, ReadonlyArray<string>>;

export type QuipPool = (typeof QUIPS)[keyof typeof QUIPS];
