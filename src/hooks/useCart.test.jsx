import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useCart } from "./useCart.js";

function CartProbe() {
  const cart = useCart({ toast_: () => {}, getNow: () => ({ timestamp: "2026-10-04T00:00:00.000Z" }) });
  return createElement("output", null, String(cart.total));
}

describe("useCart render", () => {
  it("initializes checkout callbacks without reading call-only bill parameters", () => {
    expect(renderToString(createElement(CartProbe))).toContain("<output>0</output>");
  });
});