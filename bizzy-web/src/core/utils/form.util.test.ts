import { describe, expect, test } from "vitest";
import {
  emailError,
  fieldErrors,
  moneyError,
  placeholdersError,
  requiredError,
  unknownPlaceholders,
  wholeNumberError,
} from "./form.util";

describe("form checks", () => {
  test("required", () => {
    expect(requiredError("  ", "Name is required")).toBe("Name is required");
    expect(requiredError("Jane", "Name is required")).toBeUndefined();
  });

  test("money: blank passes unless required, zero unless positive", () => {
    expect(moneyError("")).toBeUndefined();
    expect(moneyError("", { required: "What does it cost?" })).toBe("What does it cost?");
    expect(moneyError("95.50")).toBeUndefined();
    expect(moneyError("RM95")).toBeUndefined();
    expect(moneyError("9.")).toBe("An amount, like 95 or 95.50");
    expect(moneyError("0", { positive: true })).toBe("More than 0");
  });

  test("whole numbers, typed or from a number input", () => {
    expect(wholeNumberError("10", 1, 1000)).toBeUndefined();
    expect(wholeNumberError("1.5", 1, 1000)).toBe("A whole number from 1 to 1000");
    expect(wholeNumberError("0", 1, 1000)).toBe("A whole number from 1 to 1000");
    expect(wholeNumberError(7, 1, 30)).toBeUndefined();
    expect(wholeNumberError(Number.NaN, 1, 30)).toBe("A whole number from 1 to 30");
  });

  test("email, when given", () => {
    expect(emailError("")).toBeUndefined();
    expect(emailError("jane@example.com")).toBeUndefined();
    expect(emailError("jane@example")).toBe("An email address, like name@example.com");
  });

  test("placeholders a template can't use", () => {
    const known = ["name", "amount"];
    expect(unknownPlaceholders("Hi {name}, {amount} is due. {ammount} {name}", known)).toEqual(["ammount"]);
    expect(placeholdersError("Hi {name}", known)).toBeUndefined();
    expect(placeholdersError("Hi {nme} {x}", known)).toBe("{nme}, {x} aren't placeholders. Use {name} {amount}.");
  });

  test("errors as the Field shows them", () => {
    expect(fieldErrors(["Too long", undefined, "", { not: "a string" }])).toEqual([{ message: "Too long" }]);
  });
});
