# Clash Royale Deck Builder

One page. The user types a player tag, hits search, and gets **one** recommended
deck: the top-100 meta deck that best fits their card levels. No deck lists, no
routing, no comparison view. Resist scope creep toward any of those.

## Hosting

Vercel free tier + GitHub Actions. **No database, ever.** The top-100 list is a
static `public/decks.json` committed to the repo by a nightly GitHub Action.
If a change seems to need persistent storage, the design is wrong.

## Architecture

```
index.html
src/        Vite + React app. Does no computation.
api/        Vercel functions. best-deck.ts holds all the logic.
shared/     types + scoring, imported by src/, api/, scripts/
scripts/    tsx-run scripts (fixture capture, crawler)
fixtures/   real captured API responses only
public/     decks.json, cards.json
```

Flat at the repo root with plain relative imports (`../shared/types`). No `web/`
directory, no workspaces, no path aliases — see the TypeScript section for why.

All logic lives in `api/best-deck.ts`. The browser fetches that endpoint and
renders the answer; it does not score, filter, or normalize anything.

**No `vercel.json`.** Vercel's Root Directory stays the repo root, which is its
default Vite layout. Do not add an SPA catch-all rewrite — the app is one page
with no routing, and a `/(.*) → /index.html` rewrite would swallow `/api/*`.

## Secrets

`CR_API_TOKEN` must never reach the browser. It is not `VITE_`-prefixed, so Vite
structurally cannot inline it into the bundle. **Never add that prefix**, and
never pass the token through the API response or a client-side config object.

## API access

- Base URL is always a config value defaulting to `https://proxy.royaleapi.dev/v1`.
  **Never hardcode `api.clashroyale.com`.** The proxy exists because Supercell
  keys are IP-locked and serverless egress IPs are not stable.
- Token from `process.env.CR_API_TOKEN`.
- Max **5 requests/second**, enforced by one shared client (`shared/crClient.ts`).
  No direct `fetch()` calls to the API anywhere in the codebase — every call goes
  through the client so the rate limit is actually global rather than per-module.
  The limit is `CR_MAX_REQUESTS_PER_SECOND`, default 5. 5 is Supercell's ceiling,
  so that knob is for tuning **down**, never up.
- **Retry/backoff on 429 and 5xx is deliberately not implemented.** It belongs to
  the crawler PR, where it can be coupled to checkpoint/resume. Do not add it
  speculatively and do not assume it already exists. Retrying the likeliest
  failure — a 403 from an IP-allowlist misconfiguration — would turn an instant
  clear message into a slow confusing one.
- Errors carry the status, request path, and the server's response body, and
  **never the token**. `api/best-deck.ts` may surface an error message in a
  response body, so nothing that touches the `Authorization` header may be
  attached to a thrown error.

## Card levels

The API returns **rarity-relative** levels, not the levels shown in-game:

```
displayed = card.level + (GLOBAL_MAX - card.maxLevel)
```

`GLOBAL_MAX` is derived at runtime as the maximum `maxLevel` across the `/cards`
response. **Do not hardcode 13, 14, 15, or 16 anywhere.** The cap has changed
twice recently and model training data is stale on this — if you "remember" the
current cap, you are probably remembering a retired one.

**Which array inside `/cards` GLOBAL_MAX comes from is NOT decided yet.** The
response is an envelope with two arrays, `items` and `supportItems` (confirmed
against the live endpoint, not remembered). Tower troops appear to live in
`supportItems`, and if they are on a different level scale, folding them into
one maximum would skew every `levelFit` in the app. Resolve this by reading a
real capture — `npm run fixtures -- --inspect` prints the distinct `maxLevel`
values per array — then record here which array was chosen and why.

Because of that, `globalMaxLevel()` **takes an explicit array**, never the whole
`/cards` response. The caller decides what is in scope, so the decision is
visible at the call site instead of buried in a helper.

## Fixtures

**Never write a parser against a guessed API response shape.** Real responses
live in `fixtures/`. Read the fixture before writing the parser. If no fixture
exists for the endpoint you need, capture one first with `npm run fixtures`. A
hand-written fixture that merely looks plausible is worse than none: nobody can
later tell it from a real capture.

`npm run fixtures -- --inspect` prints a structural summary of what was
captured — every path, its types, array lengths, and the full value set for
low-cardinality fields. It discovers keys rather than assuming them, so reading
a response is a command rather than a discipline. Use it before writing a parser.

**Two directories, and the distinction matters:**

- `.captures/` — gitignored, byte-exact, the raw truth. Never committed.
- `fixtures/` — committed, with player tags and display names redacted.

Fixtures go to a public repo, so **identities are always redacted**. Redaction is
structure-preserving: key order and every non-identifying value (levels,
`maxLevel`, timestamps, crowns) are untouched, and placeholder tags keep the real
charset and length so they exercise parsing realistically. The one deviation from
byte-equality is that redaction re-serializes, normalizing insignificant
whitespace; `.captures/` remains the byte-exact copy. Fabricating any other field
is still forbidden.

Identity-bearing objects are recognised **structurally** — an object carrying a
tag-shaped value is a player or clan — rather than from a hardcoded list of
paths. That is what keeps the redactor honest: it works on an endpoint nobody has
looked at yet, and it does not strip card names, which carry no tag.

The leak check runs **inside** `dump-fixtures.ts`, between redacting in memory
and writing `fixtures/`, so a leak aborts the run and no leaked file ever reaches
disk. It derives the identities to look for from the capture itself rather than
from a value someone types, which cannot go stale and covers every opponent in
the battlelog, not just your own account.

## Scoring

- `levelFit = mean(1.1 ^ (level - GLOBAL_MAX))` across the 8 cards.
- `quality` = Wilson lower bound on win rate, with a **30-battle minimum**.
- `score = quality * levelFit * 100`.

Decks containing cards the player does not own are **filtered out, not scored as
zero** — a zero score still lets a deck win a comparison against other zeros, and
recommending an unbuildable deck is the single worst output this app can produce.

Fallback ladder: if strict filtering returns nothing, relax to allow **one**
missing card and flag it in the response. If that still returns nothing, return a
clear message. Never silently return a deck the player cannot build.

## Where decks.json comes from

There is no top-decks endpoint. The list is derived by us.

A nightly GitHub Action seeds player tags from the global rankings endpoint,
fetches `/players/{tag}/battlelog` for each, and aggregates. Each battlelog holds
~25 battles and every battle contains BOTH players' full 8-card decks plus the
outcome, so one request yields ~50 deck observations. Battles appear in both
players' logs, so dedupe on `(battleTime, sorted player tags)` before counting.

Decks are canonicalized by sorting the 8 card IDs and hashing the tuple. Tower
troop and evolution slots are stored in separate fields, **not** folded into the
hash. Wins and losses are attributed to both decks in a battle. Top 100 by usage,
with the Wilson bound applied at scoring time.

Budget: ~1000 seed players at 5 req/s, roughly 4 minutes per run.

**Do NOT scrape RoyaleAPI or StatsRoyale.** Their terms forbid it and it would
make our win rates someone else's methodology.

**Which rankings endpoint to seed from is NOT decided yet** — Path of Legends and
trophy rankings live at different paths and the endpoint is known to be
unreliable. The crawler PR must capture a real response to `fixtures/` and
confirm the path before writing a parser. Treat the endpoint as a config value
with a cached seed list on disk as fallback.

## decks.json provenance

`public/decks.json` carries `source: "placeholder" | "crawler"`.

- The crawler **must** write `"crawler"`.
- `api/best-deck.ts` **must** `console.warn` when it loads a file whose source is
  `"placeholder"`.
- Tests may assert `source` is one of the two literals, but must **never** assert
  a specific value — that breaks the day the crawler lands.

Until the crawler exists, `decks.json` is a hand-written placeholder and says so
in its own `source` field.

## TypeScript

Vercel `/api` functions support neither **path mappings** nor **project
references**. Keep one flat root `tsconfig.json` covering `src/`, `api/`,
`shared/`, and `scripts/`. Do not reintroduce the Vite template's
`tsconfig.app.json` / `tsconfig.node.json` split, and do not add `paths` — both
break the function build in ways that only surface at deploy time.

Vercel functions use the Web-standard signature
(`export default { fetch(request: Request) }`), so there is no `@vercel/node`
dependency.

## Runtime gotchas

**JSON imports in `api/` require an import attribute:**

```ts
import decksFile from "../public/decks.json" with { type: "json" };
```

Without it, the function crashes at cold start with
`ERR_IMPORT_ATTRIBUTE_MISSING` — Node's ESM loader, which is what actually runs
on Vercel, requires the attribute. Vite and vitest resolve JSON themselves and
never needed it, so **local `npm test` and `npm run build` pass either way**;
this only shows up in a real deploy. Both tolerate the attribute, so use it
everywhere for consistency. **This applies to `cards.json` when it lands too.**

Do not work around this by reading the file with `fs`. The static import is what
causes Vercel's tracer to include the JSON in the function bundle; switching to
`fs` trades a loud cold-start crash for a missing file at runtime.

## Workflow

- Every change goes on a branch and through a PR. **Never commit to main.**
- Each PR must be under **300 lines of hand-written code**. Generated files
  (`package-lock.json`, `public/decks.json`, `public/cards.json` — all marked
  `linguist-generated`) and Markdown do not count.
- If a PR runs over, split out mechanical config (lint, formatter, and their CI
  steps) rather than trimming docs, stubs, or tests.
