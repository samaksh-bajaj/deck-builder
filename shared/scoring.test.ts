import { describe, expect, it } from "vitest";
import { buildCollection, levelFit, score, wilsonLowerBound } from "./scoring";
import { globalMaxLevel } from "./cardLevels";
import catalogue from "../fixtures/cards.json" with { type: "json" };
import player from "../testdata/synthetic-player.json" with { type: "json" };

/**
 * Decks are written as per-card offsets below the cap — 0 is maxed, -2 is two
 * levels down — so every assertion here is cap-agnostic. The cap has changed
 * twice recently; nothing in this file may depend on its value.
 */
function fitOf(offsets: readonly number[], cap: number): number {
  return levelFit(
    offsets.map((offset) => cap + offset),
    cap,
  );
}

/** Arbitrary caps, spanning the real rarity caps and one beyond them. */
const CAPS = [6, 11, 16, 20];

const MAXED = [0, 0, 0, 0, 0, 0, 0, 0];
const TWO_BELOW = [-2, -2, -2, -2, -2, -2, -2, -2];
const ONE_SIX_BELOW = [0, 0, 0, 0, 0, 0, 0, -6];
const ONE_UNUSABLE = [0, 0, 0, 0, 0, 0, 0, -15];
const HALF_TWO_BELOW = [0, 0, 0, 0, -2, -2, -2, -2];

describe("levelFit", () => {
  it("gives a fully maxed deck a fit of exactly 1", () => {
    for (const cap of CAPS) expect(fitOf(MAXED, cap)).toBeCloseTo(1, 12);
  });

  it("ranks a maxed deck above every underlevelled one", () => {
    for (const cap of CAPS) {
      const maxed = fitOf(MAXED, cap);
      for (const deck of [TWO_BELOW, ONE_SIX_BELOW, ONE_UNUSABLE, HALF_TWO_BELOW]) {
        expect(maxed).toBeGreaterThan(fitOf(deck, cap));
      }
    }
  });

  it("penalizes one unusable card more than a mild uniform deficit", () => {
    // The property the mean alone inverts, and the reason for MIN_WEIGHT.
    // LEVEL_BASE ** (level - cap) is convex, so by Jensen a plain mean rewards
    // concentrating a deficit: seven maxed cards plus one whose fit is 0 means
    // 7/8 = 0.875, which beats eight cards two levels down at 0.826. A slot the
    // player effectively cannot use came out ahead of a coherent deck.
    for (const cap of CAPS) {
      expect(fitOf(ONE_UNUSABLE, cap)).toBeLessThan(fitOf(TWO_BELOW, cap));
    }
  });

  it("penalizes a concentrated deficit more than a spread one", () => {
    // Note which way round this is: the concentrated deck is *less*
    // underlevelled overall (six levels down in total, against eight) and still
    // scores worse. Total deficit is not what decides this — its shape is.
    for (const cap of CAPS) {
      expect(fitOf(ONE_SIX_BELOW, cap)).toBeLessThan(fitOf(HALF_TWO_BELOW, cap));
    }
  });

  it("stays inside (0, 1] however far below the cap a deck sits", () => {
    for (const cap of CAPS) {
      for (const deck of [MAXED, TWO_BELOW, ONE_SIX_BELOW, ONE_UNUSABLE, HALF_TWO_BELOW]) {
        const fit = fitOf(deck, cap);
        expect(fit).toBeGreaterThan(0);
        expect(fit).toBeLessThanOrEqual(1);
      }
    }
  });

  it("refuses an empty deck rather than returning NaN", () => {
    // A mean of nothing would sail through score() and rank a deck NaN.
    expect(() => levelFit([], 16)).toThrow(RangeError);
  });
});

describe("wilsonLowerBound", () => {
  it("ranks three battles below five hundred at a similar win rate", () => {
    // The whole reason a raw win rate is not used: both decks sit near 2/3, but
    // one of them has barely been observed.
    expect(wilsonLowerBound(2, 1)).toBeLessThan(wilsonLowerBound(333, 167));
  });

  it("ranks a perfect three-battle record below a merely good long one", () => {
    // 3-0 is a 100% observed win rate and must still lose to 333-167.
    expect(wilsonLowerBound(3, 0)).toBeLessThan(wilsonLowerBound(333, 167));
  });

  it("rises as battles accumulate at an unchanged win rate", () => {
    // More evidence for the same rate means a tighter interval, so the lower
    // bound climbs toward the observed rate rather than staying put.
    const bounds = [
      wilsonLowerBound(2, 1),
      wilsonLowerBound(20, 10),
      wilsonLowerBound(200, 100),
      wilsonLowerBound(2000, 1000),
    ];
    for (let i = 1; i < bounds.length; i++) expect(bounds[i]).toBeGreaterThan(bounds[i - 1]);
  });

  it("never exceeds the win rate actually observed", () => {
    // It is a lower bound. If it ever outran the sample it would be a rate with
    // extra steps, and small-sample decks would climb the ranking.
    for (const [wins, losses] of [
      [1, 0],
      [3, 0],
      [15, 15],
      [90, 10],
      [333, 167],
    ]) {
      expect(wilsonLowerBound(wins, losses)).toBeLessThanOrEqual(wins / (wins + losses));
    }
  });

  it("returns zero for a deck with no battles at all", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it("returns zero rather than a negative bound for a winless deck", () => {
    expect(wilsonLowerBound(0, 5)).toBe(0);
    expect(wilsonLowerBound(0, 500)).toBe(0);
  });
});

describe("score", () => {
  it("multiplies quality by fit and scales to a percentage", () => {
    expect(score(0.5, 0.8)).toBeCloseTo(40, 12);
    expect(score(1, 1)).toBe(100);
  });

  it("rises with either factor while the other is held", () => {
    expect(score(0.6, 0.5)).toBeGreaterThan(score(0.5, 0.5));
    expect(score(0.5, 0.6)).toBeGreaterThan(score(0.5, 0.5));
  });

  it("collapses to zero when a deck wins nothing, however well levelled", () => {
    expect(score(wilsonLowerBound(0, 60), fitOf(MAXED, 16))).toBe(0);
  });
});
/**
 * The synthetic player owns 12 cards. Hand-built and structurally derived from a
 * real capture — it proves the selection code handles a player shape, it does
 * not establish what that shape is. See testdata/synthetic-player.json.
 */
const items = catalogue.items;
const globalMax = globalMaxLevel(items);
const collection = buildCollection(player.cards, globalMax);

describe("buildCollection", () => {
  it("refuses a whole player response, naming the mistake", () => {
    // The trap this signature exists to close: a player response carries
    // maxLevel on badges too, on a completely unrelated achievement scale.
    expect(() => buildCollection(player as never, globalMax)).toThrow(/not a whole player response/);
  });

  it("does not see badges, which carry maxLevel on another scale entirely", () => {
    // Vacuous unless the fixture actually contains the trap, so check that too.
    expect(player.badges.some((badge) => typeof badge.maxLevel === "number")).toBe(true);
    for (const badge of player.badges) expect(collection.levels.has(badge.level)).toBe(false);
    expect(collection.levels.size).toBe(player.cards.length);
  });

  it("puts a maxed card of every rarity on the same displayed level", () => {
    // The synthetic player is maxed in all five rarities at five different raw
    // levels. If buildCollection ever stopped applying the rarity offset, four
    // of these five would drop out.
    const maxed = player.cards.filter((card) => card.level === card.maxLevel);
    expect(new Set(maxed.map((card) => card.maxLevel)).size).toBe(5);
    for (const card of maxed) expect(collection.levels.get(card.id)).toBe(globalMax);
  });
});
