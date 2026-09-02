/**
 * Domain types we own. Deliberately contains no Supercell API response types —
 * those must be derived from real captured responses in fixtures/, never guessed.
 */

/**
 * Provenance of public/decks.json. The nightly crawler must write "crawler";
 * "placeholder" means the file is hand-written and not real meta data.
 */
export type DeckSource = "placeholder" | "crawler";

/** One meta deck and the aggregated record we observed for it. */
export interface Deck {
  /** Card IDs sorted ascending. This sorted tuple is the deck's identity. */
  cards: number[];
  wins: number;
  losses: number;
}

/** The shape of public/decks.json. */
export interface DecksFile {
  source: DeckSource;
  /** ISO 8601 timestamp of when this file was produced. */
  generatedAt: string;
  decks: Deck[];
}

/** Response body of GET /api/best-deck. Widened once real logic lands. */
export interface BestDeckResponse {
  status: "stub";
  message: string;
  tag: string | null;
  deckSource: DeckSource;
}
