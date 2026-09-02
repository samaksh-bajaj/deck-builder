/**
 * The gate that stops a player identity reaching a committed fixture.
 *
 * It runs inside dump-fixtures.ts between redacting in memory and writing
 * fixtures/, so a leak aborts the run and no leaked file is ever created. A
 * check you have to remember to run is one you forget exactly once, and that
 * once is the commit that leaks.
 *
 * Identities are derived from the raw captures rather than typed in: a value
 * you supply can go stale or be mistyped, and it would only ever cover your own
 * account. Derivation covers every opponent in the battlelog too.
 */
import { collectIdentities } from "./redact";

export class RedactionLeakError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedactionLeakError";
  }
}

const TAG_RE = /#[0-9A-Z]{3,}/g;

function tagsIn(bodies: readonly string[]): Set<string> {
  return new Set(bodies.flatMap((b) => b.match(TAG_RE) ?? []));
}

/**
 * Throw unless `redacted` is free of every identity present in `raw`.
 *
 * @param extraSecrets Optional override, e.g. a name that predates a rename.
 *   Derivation is the default; this only ever adds to it.
 */
export function assertNoIdentityLeak(
  raw: readonly string[],
  redacted: readonly string[],
  extraSecrets: readonly string[] = [],
): void {
  const { tags, names } = collectIdentities(raw);
  const secrets = [...tags, ...names, ...extraSecrets].filter((s) => s.length > 0);
  const haystack = redacted.join("\n");

  // 1. Absence: no real tag or display name survives anywhere.
  const survivors = secrets.filter((s) => haystack.includes(s));
  if (survivors.length > 0) {
    throw new RedactionLeakError(
      `${survivors.length} real identity value(s) survived redaction, ` +
        `e.g. ${JSON.stringify(survivors.slice(0, 3))}. Nothing was written.`,
    );
  }

  // 2. Disjointness: the redacted tag set shares nothing with the real one.
  //    Listing tags alone proves nothing — placeholders are indistinguishable
  //    from real tags by design — so this compares the two sets directly.
  const before = tagsIn(raw);
  const after = tagsIn(redacted);
  const shared = [...after].filter((t) => before.has(t));
  if (shared.length > 0) {
    throw new RedactionLeakError(
      `${shared.length} tag(s) appear in both the raw capture and the redacted ` +
        `output, e.g. ${JSON.stringify(shared.slice(0, 3))}. Nothing was written.`,
    );
  }

  // 3. Equal cardinality: catches a collapse where many real tags map onto one
  //    placeholder. That would not leak, but it would destroy the identity
  //    relationships the crawler's battle dedupe depends on.
  if (before.size !== after.size) {
    throw new RedactionLeakError(
      `Redaction changed the number of distinct tags (${before.size} -> ` +
        `${after.size}). The mapping must be one-to-one. Nothing was written.`,
    );
  }
}
