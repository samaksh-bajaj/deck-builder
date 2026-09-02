/**
 * Print a player's cards on the in-game (displayed) level scale.
 *
 * This exists to be checked against a phone. The formula in shared/cardLevels.ts
 * is the foundation `levelFit` sits on, and nothing downstream is worth building
 * until a human has confirmed these numbers match what the game shows.
 *
 * Reads the catalogue from the committed fixture and the player from the local
 * gitignored capture, since player responses are never committed.
 */
import { readFileSync } from "node:fs";
import { displayedLevel, globalMaxLevel, type LevelledCard } from "../shared/cardLevels";

const CARDS_FIXTURE = "fixtures/cards.json";
const PLAYER_CAPTURE = ".captures/player.json";

/** Only the fields this table reads, all confirmed present in a real capture. */
interface Card extends LevelledCard {
  name: string;
  rarity: string;
}

function read(path: string, hint: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`Could not read ${path}. ${hint}`);
  }
}

const catalogue = read(
  CARDS_FIXTURE,
  "It is committed, so this probably means you are not at the repo root.",
) as { items: Card[] };

const player = read(
  PLAYER_CAPTURE,
  "Player captures are never committed. Run `npm run fixtures -- '#YOURTAG'` first.",
) as { cards: Card[] };

// The cap comes from the catalogue's items array and nothing else. Not the
// player response, which carries maxLevel on badges too; not supportItems,
// whose values coincide with the same scale today but are not guaranteed to.
const globalMax = globalMaxLevel(catalogue.items);

/**
 * Rarity display order, derived from the data rather than written down: rarest
 * cards have the lowest cap, so ordering by cap descending gives the game's own
 * common -> champion order without hardcoding a list that a new rarity breaks.
 */
const capByRarity = new Map<string, number>();
for (const card of catalogue.items) {
  capByRarity.set(card.rarity, Math.max(capByRarity.get(card.rarity) ?? 0, card.maxLevel));
}
const rarityOrder = [...capByRarity.keys()].sort(
  (a, b) => capByRarity.get(b)! - capByRarity.get(a)!,
);
const rarityRank = new Map(rarityOrder.map((r, i) => [r, i]));

const rows = player.cards
  .map((card) => ({ ...card, displayed: displayedLevel(card, globalMax) }))
  .sort(
    (a, b) =>
      rarityRank.get(a.rarity)! - rarityRank.get(b.rarity)! ||
      b.displayed - a.displayed ||
      a.name.localeCompare(b.name),
  );

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padLeft = (s: string | number, n: number) => String(s).padStart(n);

console.log(`GLOBAL_MAX = ${globalMax}`);
console.log(
  `(derived from ${CARDS_FIXTURE} .items[].maxLevel — ${catalogue.items.length} cards, ` +
    `caps ${[...new Set(catalogue.items.map((c) => c.maxLevel))].sort((a, b) => a - b).join(", ")})`,
);
console.log(`\n${player.cards.length} cards, displayed = level + (GLOBAL_MAX - maxLevel)\n`);

console.log(`${pad("rarity", 11)}${pad("card", 26)}${padLeft("lvl", 4)}${padLeft("max", 5)}${padLeft("displayed", 11)}`);
console.log("-".repeat(57));
for (const row of rows) {
  console.log(
    pad(row.rarity, 11) +
      pad(row.name, 26) +
      padLeft(row.level, 4) +
      padLeft(row.maxLevel, 5) +
      padLeft(row.displayed, 11),
  );
}

// The block to hold up against a phone. One card per rarity is enough, and the
// spread is the point: a dropped offset term produces a table that is correct
// for Commons and wrong for everything else, so a same-rarity sample proves
// nothing. Every maxed card here must read exactly GLOBAL_MAX.
console.log(`\n\n=== Phone check: your highest card in each rarity ===\n`);
for (const rarity of rarityOrder) {
  const best = rows.filter((r) => r.rarity === rarity)[0];
  if (!best) {
    console.log(`${pad(rarity, 11)}(none owned)`);
    continue;
  }
  const maxed = best.level === best.maxLevel;
  console.log(
    `${pad(rarity, 11)}${pad(best.name, 26)}` +
      `level ${padLeft(best.level, 2)} of ${padLeft(best.maxLevel, 2)}` +
      `  ->  displays as ${padLeft(best.displayed, 2)}` +
      (maxed ? `   (maxed, so must read ${globalMax})` : ""),
  );
}

const maxedInBlock = rarityOrder
  .map((r) => rows.filter((x) => x.rarity === r)[0])
  .filter((c) => c && c.level === c.maxLevel);
console.log(
  `\n${maxedInBlock.length} of these are maxed; every one should show ${globalMax}. ` +
    `If any disagrees with the game, the formula is wrong — fix it and CLAUDE.md ` +
    `before anything is built on top of it.`,
);
