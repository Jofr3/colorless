import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_ID,
  FONT_OPTIONS,
  fontFamilyFor,
  fontFamilyValue,
  SYSTEM_STACK,
} from "./fonts";

describe("fontFamilyValue", () => {
  it("wraps a named family and appends the system stack as fallback", () => {
    expect(fontFamilyValue("Inter")).toBe(`"Inter", ${SYSTEM_STACK}`);
  });

  it("returns the bare system stack for the empty family", () => {
    expect(fontFamilyValue("")).toBe(SYSTEM_STACK);
  });
});

describe("fontFamilyFor", () => {
  it("resolves a known id to its family value", () => {
    expect(fontFamilyFor("rajdhani")).toBe(fontFamilyValue("Rajdhani"));
  });

  it("resolves the system option to the bare system stack", () => {
    expect(fontFamilyFor("system")).toBe(SYSTEM_STACK);
  });

  it("falls back to the first option for an unknown id", () => {
    const fallback = FONT_OPTIONS[0];
    expect(fallback).toBeDefined();
    expect(fontFamilyFor("does-not-exist")).toBe(fontFamilyValue(fallback?.family ?? ""));
  });

  it("has a default id that maps to a real option", () => {
    expect(FONT_OPTIONS.some((option) => option.id === DEFAULT_FONT_ID)).toBe(true);
  });
});
