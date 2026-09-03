/**
 * Ranking a meta deck against one player's card levels.
 *
 * `score = quality * levelFit * 100`, where `quality` is how well the deck wins
 * for everyone and `levelFit` is how well this player can actually field it.
 *
 * This module is deliberately ignorant of card shapes. `levelFit` takes levels
 * already on the **displayed** scale, so it structurally cannot re-derive the
 * rarity offset that `displayedLevel` in ./cardLevels owns — there is exactly
 * one place that formula lives, and it is not here.
 */

import { displayedLevel } from "./cardLevels";

/** Per-card curve: each level below the cap costs ~10% of the card's fit. */
export const LEVEL_BASE = 1.1;

/**
 * How much of `levelFit` is decided by the deck's *weakest* card rather than
 * its average.
 *
 * This is the term that penalizes one badly underlevelled card, and it exists
 * because the mean alone does the opposite. `LEVEL_BASE ^ (level - globalMax)`
 * is convex, so by Jensen's inequality a mean over 8 cards *rewards*
 * concentrating a deficit: at a cap of 16, seven maxed cards plus one card so
 * bad its fit is 0 scores 7/8 = 0.875, beating eight coherent cards two levels
 * below max at 0.826. An unusable slot came out ahead of a mild uniform
 * deficit. `min` is what fixes that; the exponential is just a reasonable
 * per-card curve.
 *
 * 0.3 is the smallest value satisfying the three properties pinned in
 * ./scoring.test.ts, the binding one being "7 maxed + 1 unusable" < "8 two
 * below max" at w > 0.1179. It is a defensible default, not a figure
 * calibrated against real win rates.
 */
export const MIN_WEIGHT = 0.3;

/** z for a 95% lower confidence bound. */
export const WILSON_Z = 1.96;

/**
 * How well a player can field a deck, in (0, 1]. 1 means every card is maxed.
 *
 * A blend of the deck's average card fit and its weakest card's fit — see
 * MIN_WEIGHT for why the weakest term is not optional.
 *
 * Takes **displayed** levels, per ./cardLevels. Passing raw API levels here
 * would make every Champion look ten levels underlevelled.
 */
export function levelFit(displayedLevels: readonly number[], globalMax: number): number {
  // A mean of nothing is NaN, which would sail silently through score() and
  // come out the other end as a deck ranked NaN. Fail where the mistake is.
  if (displayedLevels.length === 0) {
    throw new RangeError("levelFit needs at least one card level.");
  }

  let total = 0;
  let weakest = Infinity;
  for (const level of displayedLevels) {
    const fit = LEVEL_BASE ** (level - globalMax);
    total += fit;
    if (fit < weakest) weakest = fit;
  }

  return (1 - MIN_WEIGHT) * (total / displayedLevels.length) + MIN_WEIGHT * weakest;
}

/**
 * Wilson lower bound on the deck's true win rate, in [0, 1].
 *
 * The point is that it is a bound, not a rate: 3 wins from 3 battles is 100%
 * observed but scores far below 300 wins from 500, because the evidence is
 * thin. That is the whole reason a raw win rate is not used.
 *
 * The 30-battle minimum from CLAUDE.md is **not** applied here. It is a
 * selection filter — decks below it are removed from the candidate pool rather
 * than scored — and it lives with the other filters in the selection layer.
 * Flooring n here would fabricate evidence and produce a number shaped like a
 * confidence bound that is not one.
 */
export function wilsonLowerBound(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 0;

  const z = WILSON_Z;
  const p = wins / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);

  return Math.max(0, (centre - margin) / (1 + z2 / n));
}

/** The final ranking number. Scaled by 100 purely so it reads as a percentage. */
export function score(quality: number, fit: number): number {
  return quality * fit * 100;
}

/** A card the player owns, as it appears in a player response's `.cards[]`. */
export interface OwnedCard {
  id: number;
  level: number;
  maxLevel: number;
}

/** A player's cards, resolved to displayed levels once so nothing re-derives them. */
export interface Collection {
  globalMax: number;
  /** Card id to displayed level. Absence from this map is what "does not own" means. */
  levels: ReadonlyMap<number, number>;
}

/**
 * Resolve a player's cards to displayed levels, once, up front.
 *
 * Takes an **explicit array** and an explicit cap, for the same reason
 * `globalMaxLevel` does: a player response carries `maxLevel` at six different
 * paths and `.badges[]` is achievement tiers on an unrelated scale. Hand this
 * `player.cards`, never `player`.
 *
 * `globalMax` must come from the **catalogue**, not from these cards. A player
 * with a small collection may own no card of the highest-capped rarity, which
 * would silently lower the cap and inflate their every `levelFit`.
 */
export function buildCollection(owned: readonly OwnedCard[], globalMax: number): Collection {
  if (!Array.isArray(owned)) {
    throw new TypeError(
      "buildCollection expects an array of cards, not a whole player response. " +
        "Pass player.cards — a player response also carries maxLevel on badges, " +
        "which are not card levels.",
    );
  }

  const levels = new Map<number, number>();
  for (const card of owned) levels.set(card.id, displayedLevel(card, globalMax));
  return { globalMax, levels };
}
