import { describe, expect, it } from "vitest";
import { displayedLevel, globalMaxLevel } from "./cardLevels";
import catalogue from "../fixtures/cards.json" with { type: "json" };

/** The real committed catalogue. Cap-agnostic assertions only — see below. */
const items = catalogue.items;
const globalMax = globalMaxLevel(items);

describe("globalMaxLevel", () => {
  it("returns the highest cap in the array it is given", () => {
    expect(globalMaxLevel([{ maxLevel: 8 }, { maxLevel: 16 }, { maxLevel: 11 }])).toBe(16);
  });

  it("refuses a whole API response, naming the mistake", () => {
    // The signature exists to stop a caller walking a player response, which
    // carries maxLevel on badges as well as on five card-shaped arrays.
    const playerResponse = { cards: [{ level: 1, maxLevel: 14 }], badges: [] };
    expect(() =>
      globalMaxLevel(playerResponse as unknown as { maxLevel: number }[]),
    ).toThrow(/not a whole API response/);
  });

  it("refuses an empty array rather than returning -Infinity", () => {
    expect(() => globalMaxLevel([])).toThrow(RangeError);
  });
});

describe("displayedLevel", () => {
  it("leaves a card at the global cap unchanged", () => {
    expect(displayedLevel({ level: 9, maxLevel: 16 }, 16)).toBe(9);
  });

  it("offsets a rarer card by the gap between its cap and the global one", () => {
    // A Champion at level 3 of 6, with a global cap of 16, shows as 13.
    expect(displayedLevel({ level: 3, maxLevel: 6 }, 16)).toBe(13);
  });
});

describe("against the real card catalogue", () => {
  // These assert properties, never the cap's numeric value. The cap has changed
  // twice recently; a test that hardcodes it fails on the day the game changes
  // rather than on the day this code breaks.

  it("gives every rarity the same displayed level when maxed", () => {
    // The invariant the phone check verifies, over all cards at once. A dropped
    // offset term would leave this true for commons and false for everything
    // else, which is exactly why the check spans rarities.
    for (const card of items) {
      expect(displayedLevel({ level: card.maxLevel, maxLevel: card.maxLevel }, globalMax)).toBe(
        globalMax,
      );
    }
  });

  it("covers several distinct rarity caps, so that property means something", () => {
    const caps = new Set(items.map((c) => c.maxLevel));
    expect(caps.size).toBeGreaterThan(1);
  });

  it("derives the cap from the most common rarity's ceiling", () => {
    // Rarer cards cap lower, so the global max must equal the highest cap of
    // any rarity present — a sanity check that no rarity exceeds the global.
    for (const card of items) expect(card.maxLevel).toBeLessThanOrEqual(globalMax);
    expect(items.some((c) => c.maxLevel === globalMax)).toBe(true);
  });

  it("never produces a displayed level above the cap for an in-range card", () => {
    for (const card of items) {
      const atCap = displayedLevel({ level: card.maxLevel, maxLevel: card.maxLevel }, globalMax);
      const atOne = displayedLevel({ level: 1, maxLevel: card.maxLevel }, globalMax);
      expect(atCap).toBeLessThanOrEqual(globalMax);
      expect(atOne).toBeGreaterThan(0);
    }
  });
});
