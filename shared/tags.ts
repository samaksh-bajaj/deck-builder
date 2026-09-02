/**
 * Player tag handling. Lives apart from crClient because api/best-deck.ts must
 * validate the ?tag= query param before deciding whether to make a request.
 */

/**
 * Canonicalize a player tag to the form the API and the UI both use: a single
 * leading "#" followed by uppercase alphanumerics.
 *
 * Accepts the shapes people actually paste: no "#", one "#", a doubled "##"
 * from copying out of the game, lowercase, and surrounding whitespace.
 *
 * The character check is a deliberately permissive [A-Z0-9]+ rather than
 * Supercell's real tag alphabet, and there is no O->0 correction. Both would
 * require asserting Supercell trivia from memory, which is exactly what
 * CLAUDE.md's card-cap warning says not to do. A false rejection here would be
 * worse than letting a malformed tag reach the API and come back as a clean
 * 404, so this only rejects input that cannot be a tag under any alphabet.
 */
export function normalizeTag(raw: string): string {
  const stripped = raw.trim().replace(/^#+/, "").toUpperCase();

  if (!/^[A-Z0-9]+$/.test(stripped)) {
    throw new TypeError(`Not a valid player tag: ${JSON.stringify(raw)}`);
  }

  return `#${stripped}`;
}

/** Normalize a tag and percent-encode it for use as a single URL path segment. */
export function encodeTag(raw: string): string {
  return encodeURIComponent(normalizeTag(raw));
}
