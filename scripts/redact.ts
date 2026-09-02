/**
 * Structure-preserving redaction of player identities.
 *
 * Fixtures are committed to a public repo, so player tags and display names
 * never land there. Everything else — key order, card levels, maxLevel,
 * timestamps, crowns — is preserved exactly; only identity values change.
 *
 * Nothing here knows the shape of any endpoint. Identity-bearing objects are
 * recognised structurally at runtime, so this file stays honest under
 * CLAUDE.md's rule against writing code against a guessed response shape.
 */

/** A tag as the API renders it. Deliberately loose about the alphabet. */
const TAG_RE = /^#[0-9A-Z]{3,}$/;

/** Keys whose value is a display name, e.g. "name", "displayName". */
const NAME_KEY_RE = /name$/i;

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/**
 * True when this object identifies a person or clan: it carries a tag-shaped
 * value of its own.
 *
 * This is the load-bearing heuristic. Card objects are keyed by numeric id and
 * carry no tag, so their names survive and the level table can still print
 * them; player and clan objects carry both a tag and a name, so both go. It
 * errs toward over-redaction: an unexpected object with a tag loses its name,
 * which costs a fixture some readability but cannot leak a person.
 */
function bearsIdentity(value: Json): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).some((v) => typeof v === "string" && TAG_RE.test(v));
}

function walk(value: Json, visit: (obj: Record<string, Json>) => void): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  visit(value);
  for (const child of Object.values(value)) walk(child, visit);
}

export interface Identities {
  /** Every tag-shaped string, anywhere in the captures. */
  tags: string[];
  /** Every display name belonging to an identity-bearing object. */
  names: string[];
}

/** Collect the real identities across all captures, for redaction and leak checks. */
export function collectIdentities(bodies: readonly string[]): Identities {
  const tags = new Set<string>();
  const names = new Set<string>();

  for (const body of bodies) {
    walk(JSON.parse(body) as Json, (obj) => {
      const identity = bearsIdentity(obj);
      for (const [key, v] of Object.entries(obj)) {
        if (typeof v !== "string") continue;
        if (TAG_RE.test(v)) tags.add(v);
        if (identity && NAME_KEY_RE.test(key)) names.add(v);
      }
    });
  }

  return { tags: [...tags], names: [...names] };
}

/**
 * Build the replacement alphabet from the characters the real tags actually
 * use, so placeholders are plausible tags rather than obvious sentinels — and
 * so tag parsing downstream is exercised against realistic input. Deriving it
 * from the capture avoids asserting Supercell's alphabet from memory.
 */
function alphabetOf(tags: readonly string[]): string {
  const chars = new Set<string>();
  for (const tag of tags) for (const c of tag.slice(1)) chars.add(c);
  // Only when there were no tags at all, so the encoder always has digits.
  if (chars.size < 2) return "0123456789";
  return [...chars].sort().join("");
}

/** Small deterministic PRNG, so placeholders are reproducible across runs. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Redactor {
  redact(body: string): string;
  /** Distinct paths that were rewritten, for the run's report. */
  paths(): string[];
}

/**
 * Create a redactor over the whole capture set.
 *
 * The mapping is shared across every body, so one real tag maps to one fake tag
 * everywhere and the battle-dedupe relationships downstream survive. It is held
 * only in memory and never written: a counter, not a hash of the input, so it
 * cannot be reversed from the committed fixtures.
 */
export function createRedactor(bodies: readonly string[]): Redactor {
  const { tags } = collectIdentities(bodies);
  const alphabet = alphabetOf(tags);
  const taken = new Set(tags);

  const tagMap = new Map<string, string>();
  const nameMap = new Map<string, string>();
  const paths = new Set<string>();

  const fakeTag = (real: string): string => {
    const existing = tagMap.get(real);
    if (existing) return existing;

    // Draw characters pseudo-randomly rather than counting up through the
    // alphabet: a counter renders as #0000000, #0000002, ... which reads as an
    // obvious sentinel and would not exercise tag parsing realistically. The
    // seed is the insertion counter, so this stays deterministic within a run
    // and is not reversible from the committed fixture.
    const width = real.length - 1;
    for (let n = tagMap.size; ; n++) {
      const next = mulberry32(n);
      let out = "";
      for (let i = 0; i < width; i++) out += alphabet[Math.floor(next() * alphabet.length)];

      const candidate = `#${out}`;
      // Never mint a placeholder that collides with a real tag.
      if (!taken.has(candidate)) {
        taken.add(candidate);
        tagMap.set(real, candidate);
        return candidate;
      }
    }
  };

  const fakeName = (real: string): string => {
    let placeholder = nameMap.get(real);
    if (!placeholder) {
      placeholder = `Player${nameMap.size + 1}`;
      nameMap.set(real, placeholder);
    }
    return placeholder;
  };

  const rewrite = (value: Json, path: string): Json => {
    if (Array.isArray(value)) return value.map((v) => rewrite(v, `${path}[]`));
    if (value === null || typeof value !== "object") return value;

    const identity = bearsIdentity(value);
    const out: Record<string, Json> = {};
    // Object.entries preserves insertion order, so key order is unchanged.
    for (const [key, v] of Object.entries(value)) {
      const here = `${path}.${key}`;
      if (typeof v === "string" && TAG_RE.test(v)) {
        out[key] = fakeTag(v);
        paths.add(here);
      } else if (typeof v === "string" && identity && NAME_KEY_RE.test(key)) {
        out[key] = fakeName(v);
        paths.add(here);
      } else {
        out[key] = rewrite(v, here);
      }
    }
    return out;
  };

  return {
    redact: (body) => JSON.stringify(rewrite(JSON.parse(body) as Json, "")),
    paths: () => [...paths].sort(),
  };
}
