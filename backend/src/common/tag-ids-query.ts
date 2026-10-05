/** Most tag ids a list filter accepts (matches the tasks service's MAX_TAG_FILTER_IDS). */
export const MAX_TAG_QUERY_IDS = 50;

/**
 * Parse a `?tag_ids=` query value into a clean id list. Accepts the CSV form
 * (`tag_ids=a,b`), the repeated form (`tag_ids=a&tag_ids=b`, which Express hands
 * over as an array) and a mix of both. Anything that isn't a string (e.g. a
 * `tag_ids[x]=y` object from the extended query parser) is ignored rather than
 * crashing the route. Blanks are dropped, duplicates removed, capped at 50.
 */
export function parseTagIdsQuery(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : [raw];
  const ids = parts
    .filter((p): p is string => typeof p === 'string')
    .flatMap((p) => p.split(','))
    .map((id) => id.trim())
    .filter(Boolean);
  return [...new Set(ids)].slice(0, MAX_TAG_QUERY_IDS);
}
