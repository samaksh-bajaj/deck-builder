/**
 * Enforces the rule that fixtures/ contains no personal data.
 *
 * .gitignore stops the two player captures from being committed by accident,
 * but .gitignore is easy to edit and `git add -f` bypasses it entirely. This
 * test fails CI instead, which is the difference between a convention and a
 * rule. It is deliberately an allowlist: a new endpoint capture has to be added
 * consciously, with someone deciding whether it carries identities.
 *
 * It asserts on what git TRACKS, not on what is sitting in the directory.
 * Running `npm run fixtures` leaves real player captures on disk by design, and
 * a directory-based check would turn the suite red for anyone following the
 * documented workflow — punishing the correct behaviour and training people to
 * ignore the one test that guards PII.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Committed captures, each confirmed to contain no player identities. */
const ALLOWED = ["cards.json"];

/** Captures that must stay local, and must remain gitignored. */
const MUST_STAY_LOCAL = ["fixtures/player.json", "fixtures/player-battlelog.json"];

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    // Never downgrade to a silent skip: this is the check that keeps player
    // data out of a public repo, so an unrunnable check is a failure.
    throw new Error(
      `Could not run \`git ${args.join(" ")}\`. This test needs a git checkout ` +
        `to tell committed fixtures from local captures.`,
      { cause: error },
    );
  }
}

const trackedJson = git(["ls-files", "--", "fixtures"])
  .split("\n")
  .filter((line) => line.endsWith(".json"))
  .map((line) => line.replace(/^fixtures\//, ""));

describe("fixtures/", () => {
  it("commits only captures known to be free of personal data", () => {
    // If this fails for a file you just captured, the answer is almost never to
    // add it to ALLOWED. Player and battlelog responses stay in gitignored
    // .captures/; regenerate them locally with `npm run fixtures`.
    expect(trackedJson.slice().sort()).toEqual(ALLOWED.slice().sort());
  });

  it("keeps player captures gitignored, so they cannot be added by accident", () => {
    // Guards the .gitignore entries themselves. Deleting them would otherwise
    // leave nothing between a stray `git add -A` and a public commit.
    for (const path of MUST_STAY_LOCAL) {
      // check-ignore exits 1 when the path is NOT ignored, which git() surfaces.
      expect(() => git(["check-ignore", "-q", "--no-index", path])).not.toThrow();
    }
  });

  it("commits no player tags", () => {
    for (const file of trackedJson) {
      const body = readFileSync(`fixtures/${file}`, "utf8");
      expect(body.match(/#[0-9A-Z]{3,}/g) ?? []).toEqual([]);
    }
  });

  it("commits only parseable JSON, so a fixture is never half-written", () => {
    for (const file of trackedJson) {
      expect(() => JSON.parse(readFileSync(`fixtures/${file}`, "utf8"))).not.toThrow();
    }
  });
});
