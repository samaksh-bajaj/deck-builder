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
 * Tags and names are checked by different means, and the difference is the
 * whole point. Tags are long and distinctive, so a substring scan over the
 * text is safe and catches a tag embedded in prose that structural redaction
 * never sees. Display names are arbitrary and often tiny — a real capture had
 * eight names of three characters or fewer, including "90" — so substring
 * scanning them matches inside icon URLs, ids, and any number containing those
 * digits. That is a false positive that aborts a clean run, so names are
 * compared structurally instead: value-at-a-name-key against value-at-a-
 * name-key, never as a substring of unrelated text.
 *
 * @param extraSecrets Optional override, e.g. a name from before a rename.
 *   Derivation is the default; this only ever adds to it. These ARE substring
 *   matched, since naming one is a deliberate "this string must not appear
 *   anywhere" — so pass something distinctive, not a two-character name.
 */
export function assertNoIdentityLeak(
  raw: readonly string[],
  redacted: readonly string[],
  extraSecrets: readonly string[] = [],
): void {
  const before = collectIdentities(raw);
  const after = collectIdentities(redacted);
  const haystack = redacted.join("\n");

  // --- Tags: unanchored substring scan, deliberately not weakened. ---

  // 1. Absence anywhere in the text, including inside a longer string. This is
  //    the only check that catches a tag that structural redaction cannot see,
  //    because redaction only rewrites values that are entirely a tag.
  const tagSurvivors = before.tags.filter((t) => haystack.includes(t));
  if (tagSurvivors.length > 0) {
    throw new RedactionLeakError(
      `${tagSurvivors.length} real tag(s) survived redaction, e.g. ` +
        `${JSON.stringify(tagSurvivors.slice(0, 3))}. Nothing was written.`,
    );
  }

  // 2. Token-set disjointness. Listing tags alone proves nothing — placeholders
  //    are indistinguishable from real tags by design — so compare the sets.
  const tagsBefore = tagsIn(raw);
  const tagsAfter = tagsIn(redacted);
  const shared = [...tagsAfter].filter((t) => tagsBefore.has(t));
  if (shared.length > 0) {
    throw new RedactionLeakError(
      `${shared.length} tag(s) appear in both the raw capture and the redacted ` +
        `output, e.g. ${JSON.stringify(shared.slice(0, 3))}. Nothing was written.`,
    );
  }

  // 3. Equal cardinality: catches a collapse where many real tags map onto one
  //    placeholder. That would not leak, but it would destroy the identity
  //    relationships the crawler's battle dedupe depends on.
  if (tagsBefore.size !== tagsAfter.size) {
    throw new RedactionLeakError(
      `Redaction changed the number of distinct tags (${tagsBefore.size} -> ` +
        `${tagsAfter.size}). The mapping must be one-to-one. Nothing was written.`,
    );
  }

  // --- Names: structural only. Never substring. ---

  // 4. No real display name is still sitting at a name key of an
  //    identity-bearing object. collectIdentities applies the same structural
  //    rule to both sides, so this compares like with like.
  const realNames = new Set(before.names);
  const nameSurvivors = after.names.filter((n) => realNames.has(n));
  if (nameSurvivors.length > 0) {
    throw new RedactionLeakError(
      `${nameSurvivors.length} real display name(s) survived redaction, e.g. ` +
        `${JSON.stringify(nameSurvivors.slice(0, 3))}. Nothing was written.`,
    );
  }

  // 5. Equal cardinality, for the same reason as tags.
  if (before.names.length !== after.names.length) {
    throw new RedactionLeakError(
      `Redaction changed the number of distinct display names ` +
        `(${before.names.length} -> ${after.names.length}). The mapping must be ` +
        `one-to-one. Nothing was written.`,
    );
  }

  // --- Caller-supplied secrets: substring, opt-in. ---
  const extraSurvivors = extraSecrets
    .filter((s) => s.length > 0)
    .filter((s) => haystack.includes(s));
  if (extraSurvivors.length > 0) {
    throw new RedactionLeakError(
      `${extraSurvivors.length} caller-supplied secret(s) survived redaction, ` +
        `e.g. ${JSON.stringify(extraSurvivors.slice(0, 3))}. Nothing was written.`,
    );
  }
}
