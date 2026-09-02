import { describe, expect, it } from "vitest";
import { encodeTag, normalizeTag } from "./tags";

describe("normalizeTag", () => {
  it("accepts the shapes people actually paste", () => {
    for (const input of ["2PP", "#2PP", "##2PP", "  #2pp  ", "2pp"]) {
      expect(normalizeTag(input)).toBe("#2PP");
    }
  });

  it("rejects input that cannot be a tag under any alphabet", () => {
    for (const input of ["", "   ", "#", "###", "2PP 9", "#2-PP"]) {
      expect(() => normalizeTag(input)).toThrow(TypeError);
    }
  });

  it("names the offending input so a bad ?tag= is diagnosable", () => {
    expect(() => normalizeTag("oops!")).toThrow(/"oops!"/);
  });
});

describe("encodeTag", () => {
  it("percent-encodes the # so the tag is one path segment", () => {
    expect(encodeTag("#2PP")).toBe("%232PP");
    expect(encodeTag("2pp")).toBe("%232PP");
  });
});
