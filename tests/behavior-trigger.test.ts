import { describe, it, expect } from "vitest";
import { matchesTrigger } from "../src/modules/behavior/behavior-trigger.js";

describe("behavior-trigger.matchesTrigger", () => {
  describe("patternKind=startswith", () => {
    it("matches when content begins with the pattern", () => {
      expect(matchesTrigger("startswith", "!ping", "!ping hello world")).toBe(true);
    });
    it("rejects when the pattern is elsewhere in the content", () => {
      expect(matchesTrigger("startswith", "!ping", "hello !ping")).toBe(false);
    });
    it("is case-sensitive (caller must lower-case if it wants otherwise)", () => {
      expect(matchesTrigger("startswith", "Hi", "hi there")).toBe(false);
    });
    it("matches empty pattern against any content", () => {
      expect(matchesTrigger("startswith", "", "anything")).toBe(true);
    });
  });

  describe("patternKind=endswith", () => {
    it("matches when content ends with the pattern", () => {
      expect(matchesTrigger("endswith", "bye!", "goodbye!")).toBe(true);
      expect(matchesTrigger("endswith", "bye", "goodbye!")).toBe(false);
    });
    it("rejects when content is shorter than the pattern", () => {
      expect(matchesTrigger("endswith", "longer-than-content", "x")).toBe(false);
    });
  });

  describe("patternKind=regex", () => {
    it("matches when the regex tests true against content", () => {
      expect(matchesTrigger("regex", "^hello\\s+world$", "hello world")).toBe(true);
    });
    it("rejects when the regex doesn't match", () => {
      expect(matchesTrigger("regex", "^foo", "bar")).toBe(false);
    });
    it("supports character classes / quantifiers", () => {
      expect(matchesTrigger("regex", "\\b\\d{4}\\b", "year 2026 update")).toBe(true);
    });
    it("returns false (not throw) when the pattern fails to compile", () => {
      // unclosed group → SyntaxError inside RegExp ctor
      expect(matchesTrigger("regex", "(unclosed", "anything")).toBe(false);
    });
    it("caches compiled regex across calls (same pattern, different content)", () => {
      // No way to read the cache directly, but observably: a malformed
      // pattern keeps returning false on every call rather than
      // somehow recovering.
      expect(matchesTrigger("regex", "(bad", "a")).toBe(false);
      expect(matchesTrigger("regex", "(bad", "b")).toBe(false);
      expect(matchesTrigger("regex", "(bad", "c")).toBe(false);
    });
    it("treats two distinct patterns as separate cache entries", () => {
      expect(matchesTrigger("regex", "^a", "abc")).toBe(true);
      expect(matchesTrigger("regex", "^b", "abc")).toBe(false);
      expect(matchesTrigger("regex", "^a", "abc")).toBe(true);
    });
  });

  describe("unknown patternKind", () => {
    it("returns false for an unrecognised kind", () => {
      // @ts-expect-error — exercising the runtime defensive branch
      expect(matchesTrigger("nonsense", "x", "x")).toBe(false);
    });
  });
});
