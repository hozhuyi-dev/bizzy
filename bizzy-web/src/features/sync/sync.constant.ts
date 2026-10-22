/**
 * Between backfill calls, so a long history doesn't use up the table's read
 * capacity all at once.
 */
export const BACKFILL_PAUSE_MS = 750;

/**
 * How long away from the app before coming back syncs again: the calendar
 * may have changed meanwhile, and nothing else would say so.
 */
export const SYNC_ON_RETURN_MS = 10 * 60_000;
