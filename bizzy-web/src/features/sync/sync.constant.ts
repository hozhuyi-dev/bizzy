/**
 * Between backfill calls, so a long history doesn't use up the table's read
 * capacity all at once.
 */
export const BACKFILL_PAUSE_MS = 750;
