// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let broken = true;
function Visualization() {
  if (broken) throw new Error("bad date");
  return createElement("p", null, "the radar");
}

describe("ErrorBoundary", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    broken = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    // React reports a caught render error on the console; that is expected here.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function render() {
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          createElement("nav", null, "tabs"),
          createElement(ErrorBoundary, { area: "Radar", children: createElement(Visualization) }),
        ),
      ),
    );
  }

  it("keeps the rest of the shell on screen when a child throws", () => {
    render();
    expect(host.textContent).toContain("tabs");
    expect(host.querySelector('[data-testid="error-boundary"]')).not.toBeNull();
    expect(host.textContent).toContain("Radar");
    expect(host.textContent).toContain("could not be shown");
  });

  it("draws the child again on Try again", () => {
    render();
    broken = false;
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again");
    expect(button).toBeDefined();
    act(() => button!.click());
    expect(host.querySelector('[data-testid="error-boundary"]')).toBeNull();
    expect(host.textContent).toContain("the radar");
  });
});
