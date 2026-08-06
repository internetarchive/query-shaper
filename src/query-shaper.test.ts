import { describe, expect, it } from "vitest";
import { QueryShaper } from "./query-shaper.js";

describe("QueryShaper", () => {
  it("registers itself as <query-shaper>", () => {
    expect(customElements.get("query-shaper")).toBe(QueryShaper);
  });

  it("resolves its Target via the for attribute", () => {
    document.body.innerHTML =
      '<input id="search"><query-shaper for="search"></query-shaper>';

    const shaper = document.querySelector("query-shaper") as QueryShaper;

    expect(shaper.target).toBeInstanceOf(HTMLInputElement);
    expect(shaper.target?.id).toBe("search");
  });

  it("sets autocomplete off on the Target once connected", () => {
    document.body.innerHTML =
      '<input id="search2"><query-shaper for="search2"></query-shaper>';

    const target = document.getElementById("search2");

    expect(target?.getAttribute("autocomplete")).toBe("off");
  });
});
