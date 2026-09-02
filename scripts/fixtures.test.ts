/**
 * Enforces the rule that fixtures/ contains no personal data.
 *
 * .gitignore stops the two player captures from being committed by accident,
 * but .gitignore is easy to edit and easy to override with `git add -f`. This
 * test fails CI instead, which is the difference between a convention and a
 * rule. It is deliberately an allowlist: a new endpoint capture has to be
 * added here consciously, with someone deciding whether it carries identities.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Committed captures, each confirmed to contain no player identities. */
const ALLOWED = ["cards.json"];

const FIXTURE_DIR = "fixtures";
const jsonFiles = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));

describe("fixtures/", () => {
  it("contains only captures known to be free of personal data", () => {
    // If this fails for a file you just captured, the answer is almost never to
    // add it here. Player and battlelog responses stay in gitignored
    // .captures/; regenerate them locally with `npm run fixtures`.
    expect(jsonFiles.slice().sort()).toEqual(ALLOWED.slice().sort());
  });

  it("holds no player tags", () => {
    for (const file of jsonFiles) {
      const body = readFileSync(`${FIXTURE_DIR}/${file}`, "utf8");
      expect(body.match(/#[0-9A-Z]{3,}/g) ?? []).toEqual([]);
    }
  });

  it("parses, so a committed capture is never half-written", () => {
    for (const file of jsonFiles) {
      expect(() =>
        JSON.parse(readFileSync(`${FIXTURE_DIR}/${file}`, "utf8")),
      ).not.toThrow();
    }
  });
});
