import { describe, expect, it } from "vitest";
import decksFile from "../public/decks.json" with { type: "json" };
import type { DeckSource } from "./types";

// Proves the test runner, tsconfig, and cross-directory imports resolve. It is
// not a scoring test. It imports nothing from api/ on purpose: Vercel functions
// run in a different environment than vitest, so reaching into the handler here
// would eventually fail for reasons unrelated to whatever it was meant to check.

const KNOWN_SOURCES: DeckSource[] = ["placeholder", "crawler"];

describe("public/decks.json", () => {
  it("declares a known provenance", () => {
    // Asserts membership, never a specific value — this file flips to "crawler"
    // the day the nightly job lands, and that must not break the suite.
    expect(KNOWN_SOURCES).toContain(decksFile.source as DeckSource);
  });

  it("is stamped with an ISO 8601 generation time", () => {
    expect(Number.isNaN(Date.parse(decksFile.generatedAt))).toBe(false);
  });

  it("holds decks of exactly eight cards, sorted ascending", () => {
    expect(decksFile.decks.length).toBeGreaterThan(0);

    for (const deck of decksFile.decks) {
      expect(deck.cards).toHaveLength(8);
      expect(new Set(deck.cards).size).toBe(8);
      expect([...deck.cards].sort((a, b) => a - b)).toEqual(deck.cards);
      expect(deck.wins + deck.losses).toBeGreaterThan(0);
    }
  });
});
