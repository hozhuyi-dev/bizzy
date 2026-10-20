import { describe, expect, test } from "vitest";
import { opensRow } from "./data-table-row.util";

describe("opensRow", () => {
  function row() {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td id="text"><span id="inner">Jane</span></td>
      <td><a id="link" href="/clients/1"><span id="in-link">Jane</span></a></td>
      <td><button id="button"><svg id="icon"></svg></button></td>
    `;
    document.body.append(tr);
    const at = (id: string) => tr.querySelector(`#${id}`) as Element;
    return { tr, at };
  }

  test("a click on the row's text opens it", () => {
    const { tr, at } = row();
    expect(opensRow(at("text"), tr, "")).toBe(true);
    expect(opensRow(at("inner"), tr, "")).toBe(true);
  });

  test("a click on a link or button, or inside one, is theirs", () => {
    const { tr, at } = row();
    expect(opensRow(at("link"), tr, "")).toBe(false);
    expect(opensRow(at("in-link"), tr, "")).toBe(false);
    expect(opensRow(at("icon"), tr, "")).toBe(false);
  });

  test("a click from a menu portaled out of the row is the menu's", () => {
    const { tr } = row();
    const item = document.createElement("div");
    item.setAttribute("role", "menuitem");
    document.body.append(item);
    expect(opensRow(item, tr, "")).toBe(false);
  });

  test("selecting text doesn't open it", () => {
    const { tr, at } = row();
    expect(opensRow(at("text"), tr, "Jane")).toBe(false);
  });
});
