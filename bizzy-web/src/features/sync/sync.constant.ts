/**
 * Between backfill calls, so a long history doesn't use up the table's read
 * capacity all at once.
 */
export const BACKFILL_PAUSE_MS = 750;

/**
 * How long since the last sync before coming back to the app syncs again:
 * the calendar may have changed meanwhile, and nothing else would say so.
 */
export const SYNC_ON_RETURN_MS = 10 * 60_000;

/** How often the app syncs while it stays in view (a desk left on all day), with no coming back to say when. */
export const SYNC_WHILE_OPEN_MS = 30 * 60_000;

/** Coming back within this of the last look asks nothing, so switching windows back and forth reads little. */
export const RETURN_PAUSE_MS = 30_000;
