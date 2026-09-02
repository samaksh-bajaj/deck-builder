/**
 * A generic structural summary of a captured response.
 *
 * This exists so the "read the fixture before writing the parser" step is a
 * command rather than a discipline. It discovers keys instead of assuming any,
 * so it is not a parser: run it against an endpoint nobody has seen and it
 * still tells you the truth about the shape.
 *
 * What it answers, without anyone guessing: whether a response is envelope-
 * wrapped, which arrays exist and how long they get, which fields are present
 * at what depth, and — for low-cardinality fields such as level caps — the full
 * set of values actually observed.
 */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** Above this, print the range rather than every value. */
const MAX_DISTINCT = 16;

interface Node {
  types: Set<string>;
  count: number;
  values: Set<Json>;
  /** Distinct lengths seen, when this path is an array. */
  lengths: Set<number>;
}

function typeOf(v: Json): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Walk, collapsing array indices to `[]` so siblings aggregate into one path. */
function visit(value: Json, path: string, nodes: Map<string, Node>): void {
  let node = nodes.get(path);
  if (!node) {
    node = { types: new Set(), count: 0, values: new Set(), lengths: new Set() };
    nodes.set(path, node);
  }
  node.types.add(typeOf(value));
  node.count++;

  if (Array.isArray(value)) {
    node.lengths.add(value.length);
    for (const item of value) visit(item, `${path}[]`, nodes);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) visit(v, `${path}.${key}`, nodes);
    return;
  }
  if (node.values.size <= MAX_DISTINCT) node.values.add(value);
}

/** Shorten one value for display, marking the cut so nothing is silently lost. */
function shorten(value: Json): string {
  const text = JSON.stringify(value) ?? "null";
  return text.length <= 24 ? text : `${text.slice(0, 23)}…"`;
}

function describe(node: Node): string {
  const parts = [[...node.types].join("|"), `x${node.count}`];

  if (node.lengths.size > 0) {
    const lengths = [...node.lengths].sort((a, b) => a - b);
    parts.push(
      lengths.length <= 4
        ? `len ${lengths.join(",")}`
        : `len ${lengths[0]}..${lengths[lengths.length - 1]}`,
    );
  }

  if (node.values.size > 0 && node.values.size <= MAX_DISTINCT) {
    const values = [...node.values];
    // Every value is shown, never silently truncated. An earlier version sliced
    // strings to the first four with no marker, which made a five-value rarity
    // field read as four and hid the existence of champion cards entirely.
    // Long strings are shortened individually, with an explicit ellipsis.
    const numeric = values.every((v) => typeof v === "number");
    if (numeric) {
      parts.push(`= ${(values as number[]).sort((a, b) => a - b).join(",")}`);
    } else {
      parts.push(`= ${values.map(shorten).join(",")}`);
    }
  } else if (node.values.size > MAX_DISTINCT) {
    parts.push(`= <more than ${MAX_DISTINCT} distinct values>`);
  }

  return parts.join("  ");
}

/** Render a path-by-path summary of one captured body. */
export function summarize(body: string): string {
  const nodes = new Map<string, Node>();
  visit(JSON.parse(body) as Json, "", nodes);

  return [...nodes.entries()]
    .filter(([path]) => path !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, node]) => `  ${path.padEnd(44)} ${describe(node)}`)
    .join("\n");
}
