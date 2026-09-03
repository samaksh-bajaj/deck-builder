/**
 * Which rankings endpoint seeds the crawler.
 *
 * Confirmed against the live API, not remembered. `/locations` lists 262
 * locations, and the global one exposes two player leaderboards:
 *
 *   /locations/global/pathoflegend/players   200, items: 1000   <- this one
 *   /locations/global/rankings/players       200, items: []
 *
 * The trophy leaderboard is the trap CLAUDE.md warns about when it calls this
 * endpoint unreliable. It does not 404 and it does not error — it answers 200
 * with an empty array. A crawler pointed at it would seed zero tags, fetch
 * nothing, aggregate nothing, and report success. **Any seeding path must
 * therefore treat an empty items array as a failure**, not merely a non-2xx
 * status, or the loudest symptom of a broken seed is no symptom at all.
 *
 * The Path of Legends leaderboard returns all 1000 entries in a single request
 * and `paging.cursors` comes back empty, so there is no pagination to write.
 * `limit` is honoured downward but clamps at 1000; asking for 2000 still
 * returns 1000. That makes the seeding budget exactly one request.
 *
 * Kept as a config value because CLAUDE.md is right that this endpoint is
 * historically unreliable: if it starts answering empty the way the trophy one
 * does, the fix should be an env var rather than a deploy.
 */
export const DEFAULT_RANKINGS_PATH = "/locations/global/pathoflegend/players";

/** The seed endpoint path. Override with CR_RANKINGS_PATH. */
export function rankingsPath(): string {
  return process.env.CR_RANKINGS_PATH || DEFAULT_RANKINGS_PATH;
}
