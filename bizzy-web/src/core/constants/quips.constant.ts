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
  // Under Home's title: one a day, the same all day.
  home: [
    "The hive is open.",
    "Busy as usual.",
    "Another day, another flower.",
    "Wings on. Let's go.",
    "Bee here now.",
    "The honey won't make itself.",
    "Today's forecast: buzzing.",
    "Small hive, big plans.",
    "One bee, many flowers.",
    "The comb is in order.",
    "Pollen first, paperwork later.",
    "Steady wings, steady hands.",
    "Keeping the hive humming.",
    "All buzz, no fuss.",
    "A good day for flowers.",
    "Mind the bees, mind the knees.",
    "Back on the wing.",
    "Sweet work ahead.",
    "The bees have tidied up.",
    "Hum along.",
  ],
  // Nothing booked today.
  sessionsToday: [
    "A day off for the bees.",
    "No flowers on the route today.",
    "The hive's quiet today.",
    "An empty diary. Enjoy it.",
  ],
  // Under the toast for a to-do done right there: never for money, or
  // for cancelling and deleting.
  todoDone: [
    "One less buzz.",
    "Another cell filled.",
    "The hive approves.",
    "Neatly done.",
    "Wings a little lighter.",
    "Busy bee.",
  ],
  // Under the toast for something saved: a client, a contact, a
  // follow-up, settings, a file on a session.
  saved: [
    "Tucked into the hive.",
    "Filed in the comb.",
    "Safe in the hive.",
    "Noted. The bees never forget.",
    "All in order.",
  ],
  // Under the toast for a session booked or moved.
  booked: [
    "Another date in the diary.",
    "The hive's getting busy.",
    "Pencilled in. Well, inked.",
    "One more flower to visit.",
  ],
  // The last to-do of a visit cleared.
  todoCleared: [
    "Every cell sealed. Off you buzz.",
    "Cleared the lot. Take a honey break.",
    "Not a single loose end. Well flown.",
    "The hive is spotless. All your doing.",
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
  clientsReconnect: [
    "Nobody's wandered off.",
    "Everyone's been buzzed.",
    "The whole hive is accounted for.",
    "No strays today.",
    "Everyone's coming back. Probably.",
  ],
  followUps: [
    "No one to chase. Lovely.",
    "The reminder jar is empty.",
    "Nothing to buzz back about.",
    "All quiet on the follow-up front.",
  ],
  followUpsDone: [
    "Nothing ticked off yet.",
    "The done pile is waiting.",
    "No finished buzzing so far.",
    "A clean slate of done.",
  ],
  sessionsDeleted: [
    "Nothing in the bin.",
    "No lost sessions. Tidy hive.",
    "The bin is spotless.",
    "Nothing fell out of the calendar.",
  ],
  timeline: [
    "The story starts with a first visit.",
    "No visits on record yet.",
    "A blank page in the hive diary.",
    "Nothing written down. Yet.",
  ],
  invoices: [
    "No invoices out. Nothing owed.",
    "The bill book is untouched.",
    "Not an invoice in the hive.",
    "Nobody's been billed. Yet.",
  ],
  expenses: [
    "Not a penny spent. Yet.",
    "The hive bought nothing.",
    "No receipts in the comb.",
    "The bees kept their wallets shut.",
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
  insightsSpending: [
    "Not a sen spent. Frugal bee.",
    "The wallet's been napping.",
    "No receipts in the hive.",
    "Quiet year at the till.",
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
