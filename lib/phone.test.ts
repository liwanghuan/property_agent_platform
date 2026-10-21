import { describe, expect, it } from "vitest";
import { toE164 } from "./phone";

describe("toE164", () => {
  it.each([
    ["9123 4567", "+6591234567"],
    ["+65 9123-4567", "+6591234567"],
    ["6591234567", "+6591234567"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("%s -> %s", (input, expected) => expect(toE164(input)).toBe(expected));

  it.each(["", "1234", "91234", "abc"])("rejects %j", (input) => expect(toE164(input)).toBeNull());
});
