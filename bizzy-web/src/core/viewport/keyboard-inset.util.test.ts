import { describe, expect, it } from "vitest";
import { keyboardInset, opensKeyboard, revealBy } from "./keyboard-inset.util";
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

describe("opensKeyboard", () => {
  const input = (type: string, { readOnly = false, disabled = false } = {}) => {
    const element = document.createElement("input");
    element.type = type;
    element.readOnly = readOnly;
    element.disabled = disabled;
    return element;
  };

  it("is true of a box typed into", () => {
    expect(opensKeyboard(document.createElement("input"))).toBe(true);
    expect(opensKeyboard(input("search"))).toBe(true);
    expect(opensKeyboard(input("number"))).toBe(true);
    expect(opensKeyboard(document.createElement("textarea"))).toBe(true);
  });

  it("is false of a date or time, which opens a picker", () => {
    expect(opensKeyboard(input("date"))).toBe(false);
    expect(opensKeyboard(input("time"))).toBe(false);
  });

  it("is false of what is tapped, read only or off", () => {
    expect(opensKeyboard(input("checkbox"))).toBe(false);
    expect(opensKeyboard(input("text", { readOnly: true }))).toBe(false);
    expect(opensKeyboard(input("text", { disabled: true }))).toBe(false);
    expect(opensKeyboard(document.createElement("button"))).toBe(false);
    expect(opensKeyboard(null)).toBe(false);
  });
});

describe("revealBy", () => {
  const view = { viewTop: 100, viewBottom: 400 };

  it("is 0 for a box in view", () => {
    expect(revealBy({ ...view, boxTop: 150, boxBottom: 190 })).toBe(0);
  });

  it("brings a box under what can be seen up to the middle", () => {
    // Middle of 100–400 is 250: the box's middle (520) moves up 270.
    expect(revealBy({ ...view, boxTop: 500, boxBottom: 540 })).toBe(270);
  });

  it("brings a box above what can be seen down to the middle", () => {
    expect(revealBy({ ...view, boxTop: 20, boxBottom: 60 })).toBe(-210);
  });
});
