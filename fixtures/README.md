# fixtures/

**Only real, captured API responses belong in this directory.**

Never hand-write a file here to make a parser compile. A fabricated fixture that
looks plausible is worse than no fixture at all: the next person cannot tell it
from a real capture, and every parser built on it inherits the guess.

## Capturing

```sh
npm run fixtures -- '#YOURTAG'   # capture, redact, and write
npm run fixtures -- --inspect    # structure summary only, from .captures/
npm run fixtures -- --offline    # re-derive fixtures from .captures/, no token
```

Quote the tag — an unquoted `#` starts a comment in most shells.

Three files, one per endpoint: `cards.json` (`GET /cards`), `player.json`
(`GET /players/{tag}`), and `player-battlelog.json` (`GET /players/{tag}/battlelog`).
One canonical capture each, overwritten on re-run. They are stored as received,
on a single line — reformatting is reshaping. Read them with `--inspect` or `jq`.

## Raw vs. redacted

Captures land in two places:

- `.captures/` — gitignored, byte-exact, the raw truth.
- `fixtures/` — committed, with player tags and display names redacted.

Everything else is preserved exactly: key order, card levels, `maxLevel`,
timestamps, crowns. The single deviation from byte-equality is that redaction
re-serializes the JSON, which normalizes insignificant whitespace; `.captures/`
is the byte-exact copy if you ever need it.

Placeholder tags are drawn from the character set the real tags actually use and
keep their original length, so they are realistic input for tag parsing rather
than obvious sentinels. One real tag maps to one placeholder across all three
files, so the identity relationships the crawler's battle dedupe depends on
survive. The mapping is held in memory only and never written.

## The leak check

`dump-fixtures.ts` verifies redaction **before** it writes anything here, so a
leak aborts the run and no leaked file is ever created. It derives the identities
to search for from the capture itself — every tag and every display name,
including all ~25 opponents in the battlelog — rather than from a value someone
types, which could go stale or be mistyped.

**Tags and names are checked by different means, and unifying them is a bug.**

- **Tags** — unanchored substring scan over the redacted text, plus token-set
  disjointness and equal cardinality. Tags are long and distinctive, so this is
  safe, and it is the only check that catches a tag embedded inside a longer
  string, which redaction cannot see.
- **Names** — structural only: the set of values at name keys of
  identity-bearing objects, compared against the same set from the raw capture,
  and required to be equal in size.

Never substring-match a display name. A real capture had an opponent named `90`,
and eight names of three characters or fewer. Scanning the redacted text for
`90` matched inside an icon URL (`...MKK90sTIE88.png`) and inside ids like
`159000000`, aborting a run whose redaction was in fact perfect.

If it aborts on a tag embedded inside a longer string, that is working as
intended — redaction only rewrites values that are entirely a tag, and the check
is the backstop. Nothing was written; fix the redactor before re-running.

## What gets over-redacted, on purpose

Every tag-shaped value is rewritten, including `eventTag` and `modifiers[].tag`,
which identify game content rather than people. Leaving a tag alone because it
looks like content is how a player tag eventually slips through, so the redactor
does not try to tell them apart. `gameMode.name` and `arena.name` survive, so
filtering battles by mode still works.
