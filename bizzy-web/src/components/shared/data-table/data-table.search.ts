/** What a column offers the search: one or more pieces of text, as shown. */
export type SearchText = string | number | null | undefined | ReadonlyArray<string | number | null | undefined>;

/** Lowercase, without accents, so "José" is found by "jose". */
export function normalize(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The query as words, without punctuation hugging them ("jane," → "jane"). */
export function tokenize(query: string): Array<string> {
  return normalize(query)
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

/** One row's searchable text, one entry per column value. */
export function toFields(texts: ReadonlyArray<SearchText>): Array<string> {
  return texts
    .flat()
    .filter((text): text is string | number => text !== null && text !== undefined && text !== "")
    .map((text) => normalize(String(text)));
}

const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);

/** 3 for a whole word, 2 for the start of a word, 1 for anywhere, 0 for no match. */
function matchQuality(word: string, field: string): number {
  let best = 0;
  for (let at = field.indexOf(word); at >= 0; at = field.indexOf(word, at + 1)) {
    if (isWordChar(field[at - 1])) {
      best = Math.max(best, 1);
      continue;
    }
    if (!isWordChar(field[at + word.length])) return 3;
    best = 2;
  }
  return best;
}

/**
 * How well a row matches: every word must match at least one field, else 0
 * and the row is left out. Otherwise each word adds its best match, so rows
 * that match whole words, or more of the words, rank higher.
 */
export function scoreFields(words: ReadonlyArray<string>, fields: ReadonlyArray<string>): number {
  let score = 0;
  for (const word of words) {
    let best = 0;
    for (const field of fields) {
      best = Math.max(best, matchQuality(word, field));
      if (best === 3) break;
    }
    if (best === 0) return 0;
    score += best;
  }
  return score;
}

/**
 * The items that match every word, best match first. Equal scores keep their
 * order, so the table's own sort decides between them.
 */
export function searchItems<T>(items: ReadonlyArray<T>, query: string, fieldsOf: (item: T) => Array<string>): Array<T> {
  const words = tokenize(query);
  if (words.length === 0) return [...items];
  return items
    .map((item, index) => ({ item, index, score: scoreFields(words, fieldsOf(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
