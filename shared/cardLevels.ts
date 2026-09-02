/**
 * Converting the API's rarity-relative card levels into the numbers the game
 * actually shows.
 *
 * The API reports a card's level relative to its own rarity's cap, so a maxed
 * Champion reports level 6 and a maxed Common reports level 16. Both are level
 * 16 in game. Every comparison in this app — and `levelFit` in particular —
 * has to be on the displayed scale, or Champions look permanently underlevelled.
 */

/** The minimum a card object must carry to have a displayed level computed. */
export interface LevelledCard {
  level: number;
  maxLevel: number;
}

/**
 * The highest `maxLevel` across the cards given, i.e. the in-game level cap.
 *
 * Takes an **explicit array**, never a `/cards` or `/players/{tag}` response.
 * That is not stylistic. A player response carries `maxLevel` at six different
 * paths — `.badges[]`, `.cards[]`, `.supportCards[]`, `.currentDeck[]`,
 * `.currentDeckSupportCards[]`, and `.currentFavouriteCard`, the last not even
 * an array — and `.badges[]` is achievement tiers on a completely unrelated
 * scale, 142 of them in a real capture. Anything that walks a response looking
 * for `maxLevel` will silently fold those in. Forcing the caller to name the
 * array puts that decision at the call site where it is visible.
 *
 * The cap has changed twice recently, so it is always derived, never written
 * down. If you think you remember its current value, you are remembering a
 * retired one.
 */
export function globalMaxLevel(cards: readonly { maxLevel: number }[]): number {
  // Runtime guard, because callers hand us JSON.parse output that TypeScript
  // cannot vouch for. Passing a whole response here is the mistake this
  // signature exists to prevent, so say so rather than returning -Infinity.
  if (!Array.isArray(cards)) {
    throw new TypeError(
      "globalMaxLevel expects an array of cards, not a whole API response. " +
        "Name the array you mean, e.g. cardsResponse.items — a player response " +
        "carries maxLevel on badges too, which are not card levels.",
    );
  }
  if (cards.length === 0) {
    throw new RangeError("globalMaxLevel needs at least one card to derive a cap.");
  }

  return Math.max(...cards.map((card) => card.maxLevel));
}

/**
 * The level the game displays for a card, given the global cap.
 *
 * `displayed = level + (globalMax - maxLevel)`. A maxed card of any rarity
 * displays exactly `globalMax`, which is the property worth checking against a
 * real account.
 */
export function displayedLevel(card: LevelledCard, globalMax: number): number {
  return card.level + (globalMax - card.maxLevel);
}
