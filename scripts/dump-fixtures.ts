/**
 * Capture real Clash Royale API responses into fixtures/.
 *
 * This script deliberately does NOT parse the responses or know any field name
 * beyond what redaction discovers structurally. Reading the captures comes
 * first; the card-level table is a later change, written against real bytes.
 *
 * Two directories, on purpose:
 *   .captures/  gitignored, byte-exact, the raw truth
 *   fixtures/   committed, identities redacted, structurally identical
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { crFetchText } from "../shared/crClient";
import { encodeTag, normalizeTag } from "../shared/tags";
import { rankingsPath } from "../shared/rankings";
import { createRedactor } from "./redact";
import { assertNoIdentityLeak } from "./checkRedaction";
import { summarize } from "./inspect";

const RAW_DIR = ".captures";
const FIXTURE_DIR = "fixtures";

const USAGE = `
Capture real API responses into fixtures/.

  npm run fixtures -- '#YOURTAG'     capture from the API, then redact and write
  npm run fixtures -- --offline      re-derive from .captures/, no token needed
  npm run fixtures -- --inspect      print the structure summary only

Quote the tag: an unquoted # starts a comment in most shells.

Raw responses land in .captures/ (gitignored). Only redacted copies reach
fixtures/. If any real tag or display name would survive, the run aborts and
writes nothing.
`.trim();

/** Endpoint path builder -> filename. */
const ENDPOINTS = [
  { file: "cards.json", path: () => "/cards" },
  { file: "player.json", path: (t: string) => `/players/${t}` },
  { file: "player-battlelog.json", path: (t: string) => `/players/${t}/battlelog` },
  // Ignores the tag: the crawler's seed list is nobody's account in particular.
  // 1000 real players, so it stays local like the two above.
  { file: "rankings.json", path: () => rankingsPath() },
];

function parseArgs(argv: readonly string[]) {
  // Flags first: reading argv[2] positionally would treat "--offline" as a tag.
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positionals = argv.filter((a) => !a.startsWith("--"));

  for (const flag of flags) {
    if (!["--offline", "--inspect", "--help"].includes(flag)) {
      throw new Error(`Unknown flag ${flag}\n\n${USAGE}`);
    }
  }

  const help = flags.has("--help");
  const offline = flags.has("--offline") || flags.has("--inspect");
  // --offline re-derives from disk, so it needs no tag and no identity.
  // --help must be checked first, or asking for help is itself a usage error.
  if (!help && !offline && positionals.length === 0) {
    throw new Error(`A player tag is required.\n\n${USAGE}`);
  }

  return {
    help,
    inspectOnly: flags.has("--inspect"),
    offline,
    tag: positionals[0] ? normalizeTag(positionals[0]) : null,
  };
}

async function capture(tag: string): Promise<string[]> {
  const encoded = encodeTag(tag);
  const bodies: string[] = [];
  mkdirSync(RAW_DIR, { recursive: true });

  // Sequential, so the shared client's rate limit is obvious in the output.
  for (const endpoint of ENDPOINTS) {
    const path = endpoint.path(encoded);
    process.stdout.write(`GET ${path} ... `);
    const body = await crFetchText(path);
    console.log(`${body.length} bytes`);
    // Written straight away. .captures/ is gitignored, so this is safe, and it
    // means a later abort leaves the capture on disk to retry with --offline
    // rather than spending the API calls again.
    writeFileSync(`${RAW_DIR}/${endpoint.file}`, body);
    bodies.push(body);
  }
  return bodies;
}

function readCaptures(): string[] {
  return ENDPOINTS.map((endpoint) => {
    try {
      return readFileSync(`${RAW_DIR}/${endpoint.file}`, "utf8");
    } catch {
      throw new Error(
        `${RAW_DIR}/${endpoint.file} is missing. Run with a tag first to capture it.`,
      );
    }
  });
}

function main(bodies: string[], inspectOnly: boolean): void {
  console.log("\n=== structure of the raw captures ===");
  console.log("Paths collapse array indices to []; values shown when few enough.\n");
  ENDPOINTS.forEach((endpoint, i) => {
    console.log(`${endpoint.file}:`);
    console.log(summarize(bodies[i]));
    console.log("");
  });

  if (inspectOnly) return;

  const redactor = createRedactor(bodies);
  const redacted = bodies.map((body) => redactor.redact(body));

  // Before anything is written: a leak aborts here, leaving no file on disk.
  assertNoIdentityLeak(bodies, redacted);

  mkdirSync(FIXTURE_DIR, { recursive: true });
  ENDPOINTS.forEach((endpoint, i) => {
    writeFileSync(`${FIXTURE_DIR}/${endpoint.file}`, redacted[i]);
  });

  console.log("=== redaction ===");
  console.log(`Rewrote these paths:\n  ${redactor.paths().join("\n  ") || "(none)"}`);
  console.log(`\nWrote ${ENDPOINTS.length} redacted fixtures to ${FIXTURE_DIR}/`);
  console.log("Leak check passed: no real tag or display name reached fixtures/.");
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
  } else if (args.offline || args.tag === null) {
    main(readCaptures(), args.inspectOnly);
  } else {
    main(await capture(args.tag), args.inspectOnly);
  }
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
