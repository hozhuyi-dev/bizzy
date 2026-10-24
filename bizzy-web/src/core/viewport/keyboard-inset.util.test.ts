import { describe, expect, it } from "vitest";
import { isTypedInto, keyboardInset } from "./keyboard-inset.util";
import type { ViewportReading } from "./keyboard-inset.util";

// An iPhone's screen in Chrome, its bars shown, nothing typed into.
const SCREEN: ViewportReading = { layoutHeight: 760, height: 760, offsetTop: 0, scale: 1, editing: false };

describe("keyboardInset", () => {
  it("is what the keyboard covers while something is typed into", () => {
    expect(keyboardInset({ ...SCREEN, height: 424, editing: true })).toBe(336);
  });

  it("leaves out how far the page is scrolled under the keyboard", () => {
    expect(keyboardInset({ ...SCREEN, height: 424, offsetTop: 100, editing: true })).toBe(236);
  });

  it("is 0 with nothing typed into, whatever the screen lost", () => {
    expect(keyboardInset({ ...SCREEN, height: 424 })).toBe(0);
  });

  it("reads the browser's bars coming back as no keyboard", () => {
    expect(keyboardInset({ ...SCREEN, height: 700, editing: true })).toBe(0);
  });

  it("reads the page bouncing at the top as no keyboard", () => {
    expect(keyboardInset({ ...SCREEN, offsetTop: -80, editing: true })).toBe(0);
  });

  it("is 0 while zoomed in", () => {
    expect(keyboardInset({ ...SCREEN, height: 380, scale: 2, editing: true })).toBe(0);
  });
});

describe("isTypedInto", () => {
  const input = (type: string, { readOnly = false, disabled = false } = {}) => {
    const element = document.createElement("input");
    element.type = type;
    element.readOnly = readOnly;
    element.disabled = disabled;
    return element;
  };

  it("is true of a box typed into", () => {
    expect(isTypedInto(input("text"))).toBe(true);
    expect(isTypedInto(input("search"))).toBe(true);
    expect(isTypedInto(document.createElement("textarea"))).toBe(true);
  });

  it("is false of what is tapped, read only or off", () => {
    expect(isTypedInto(input("checkbox"))).toBe(false);
    expect(isTypedInto(input("text", { readOnly: true }))).toBe(false);
    expect(isTypedInto(input("text", { disabled: true }))).toBe(false);
    expect(isTypedInto(document.createElement("button"))).toBe(false);
    expect(isTypedInto(null)).toBe(false);
  });
});
