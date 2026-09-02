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

It asserts three things: no real tag or name survives; the redacted tag set is
disjoint from the real one (listing tags alone proves nothing, since placeholders
are indistinguishable from real tags by design); and the two sets are the same
size, so the mapping stayed one-to-one.

If it aborts on a tag embedded inside a longer string, that is working as
intended — redaction only rewrites values that are entirely a tag, and the check
is the backstop. Nothing was written; fix the redactor before re-running.
