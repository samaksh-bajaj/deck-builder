/**
 * Inputs here are hand-written and obviously synthetic. They are test inputs,
 * not fixtures: nothing in this file claims to be a real API response, and
 * nothing in it may be copied into fixtures/.
 */
import { describe, expect, it } from "vitest";
import { collectIdentities, createRedactor } from "./redact";
import { assertNoIdentityLeak, RedactionLeakError } from "./checkRedaction";

/** A battle-shaped body: two players per side, a clan, and cards. */
const BATTLELOG = JSON.stringify([
  {
    battleTime: "20260101T120000.000Z",
    gameMode: { id: 72000006, name: "Ladder" },
    team: [
      {
        tag: "#AAA111",
        name: "RealPlayerOne",
        clan: { tag: "#CLAN99", name: "RealClanName" },
        cards: [{ id: 26000000, name: "Knight", level: 11, maxLevel: 14 }],
      },
      { tag: "#BBB222", name: "RealPlayerTwo", cards: [] },
    ],
    opponent: [{ tag: "#CCC333", name: "RealPlayerThree", cards: [] }],
  },
  {
    battleTime: "20260101T130000.000Z",
    team: [{ tag: "#AAA111", name: "RealPlayerOne", cards: [] }],
    opponent: [{ tag: "#DDD444", name: "RealPlayerFour", cards: [] }],
  },
]);

const redactOne = (body: string) => createRedactor([body]).redact(body);

describe("collectIdentities", () => {
  it("finds every tag and every name at any depth, including 2v2 sides", () => {
    const { tags, names } = collectIdentities([BATTLELOG]);

    expect(new Set(tags)).toEqual(
      new Set(["#AAA111", "#BBB222", "#CCC333", "#DDD444", "#CLAN99"]),
    );
    expect(new Set(names)).toEqual(
      new Set([
        "RealPlayerOne",
        "RealPlayerTwo",
        "RealPlayerThree",
        "RealPlayerFour",
        "RealClanName",
      ]),
    );
  });

  it("does not mistake a card name for a person", () => {
    // Card objects carry no tag, so they are not identity-bearing.
    expect(collectIdentities([BATTLELOG]).names).not.toContain("Knight");
  });
});

describe("createRedactor", () => {
  it("removes every real identity", () => {
    const out = redactOne(BATTLELOG);
    for (const secret of ["#AAA111", "#CLAN99", "RealPlayerOne", "RealClanName"]) {
      expect(out).not.toContain(secret);
    }
  });

  it("keeps card names and the game mode, which are not identities", () => {
    const out = redactOne(BATTLELOG);
    expect(out).toContain("Knight");
    expect(out).toContain("Ladder");
  });

  it("preserves structure, key order, and every non-identity value", () => {
    const before = JSON.parse(BATTLELOG);
    const after = JSON.parse(redactOne(BATTLELOG));

    const shape = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(shape)
        : v && typeof v === "object"
          ? Object.keys(v) // key order, not just membership
          : typeof v;
    expect(shape(after)).toEqual(shape(before));

    expect(after[0].gameMode).toEqual(before[0].gameMode);
    expect(after[0].team[0].cards[0]).toEqual(before[0].team[0].cards[0]);
    expect(after[0].battleTime).toBe(before[0].battleTime);
  });

  it("maps one real tag to one placeholder everywhere it appears", () => {
    const after = JSON.parse(redactOne(BATTLELOG));
    // #AAA111 is the same player in both battles.
    expect(after[0].team[0].tag).toBe(after[1].team[0].tag);
    expect(after[0].team[0].name).toBe(after[1].team[0].name);
    // Distinct people stay distinct, or battle dedupe breaks downstream.
    expect(after[0].team[0].tag).not.toBe(after[0].team[1].tag);
  });

  it("mints placeholders of the real length from the observed alphabet", () => {
    const after = JSON.parse(redactOne(BATTLELOG));
    const observed = new Set("ABCD1234");

    for (const tag of [after[0].team[0].tag, after[0].opponent[0].tag]) {
      expect(tag).toMatch(/^#[0-9A-Z]+$/);
      expect(tag).toHaveLength("#AAA111".length);
      expect([...tag.slice(1)].every((c: string) => observed.has(c))).toBe(true);
    }
  });

  it("shares the mapping across bodies so cross-file identity survives", () => {
    const player = JSON.stringify({ tag: "#AAA111", name: "RealPlayerOne" });
    const redactor = createRedactor([player, BATTLELOG]);

    const fromPlayer = JSON.parse(redactor.redact(player));
    const fromLog = JSON.parse(redactor.redact(BATTLELOG));

    expect(fromPlayer.tag).toBe(fromLog[0].team[0].tag);
  });

  it("reports the paths it rewrote", () => {
    const redactor = createRedactor([BATTLELOG]);
    redactor.redact(BATTLELOG);

    expect(redactor.paths()).toContain("[].team[].tag");
    expect(redactor.paths()).toContain("[].team[].clan.name");
    expect(redactor.paths()).not.toContain("[].team[].cards[].name");
  });
});

describe("assertNoIdentityLeak", () => {
  it("passes on correctly redacted output", () => {
    expect(() =>
      assertNoIdentityLeak([BATTLELOG], [redactOne(BATTLELOG)]),
    ).not.toThrow();
  });

  it("catches a name that survived", () => {
    const leaky = redactOne(BATTLELOG).replace(/"Player1"/, '"RealPlayerOne"');
    expect(() => assertNoIdentityLeak([BATTLELOG], [leaky])).toThrow(
      RedactionLeakError,
    );
  });

  it("catches a tag embedded in a longer string, which redaction cannot see", () => {
    // Redaction only rewrites values that are entirely a tag, so a tag inside
    // prose would survive it. collectIdentities is anchored too and would not
    // list it, so the absence arm misses it as well — the unanchored
    // disjointness scan is the only thing standing between this and a commit.
    // Failing loudly is correct: nothing is written and the run says why.
    const raw = JSON.stringify({ note: "beat #EEE555 today" });
    expect(() => assertNoIdentityLeak([raw], [raw])).toThrow(/both/);
  });

  it("catches a mapping that collapses distinct players onto one tag", () => {
    const collapsed = JSON.stringify(
      JSON.parse(redactOne(BATTLELOG)).map((b: { team: { tag: string }[] }) => ({
        ...b,
        team: b.team.map((p) => ({ ...p, tag: "#ZZZ999" })),
      })),
    );
    expect(() => assertNoIdentityLeak([BATTLELOG], [collapsed])).toThrow(
      /one-to-one/,
    );
  });

  it("accepts an optional extra secret, e.g. a name from before a rename", () => {
    const out = redactOne(BATTLELOG);
    expect(() => assertNoIdentityLeak([BATTLELOG], [out], ["Knight"])).toThrow(
      RedactionLeakError,
    );
  });
});
