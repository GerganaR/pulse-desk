import { makeSession } from "@pulsedesk/test-utils";
import { act, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClockProvider } from "@/lib/clock";
import { SessionsTable, VIRTUALIZE_ROWS_ABOVE } from "./SessionsTable";

const NOW = 1_760_000_000_000;
const ROW = 61;

const sessions = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    makeSession({
      id: `ses_${i}`,
      lastActivityAt: NOW - i * 1_000,
      visitor: { id: `v${i}`, label: `Visitor #${i}`, name: null, city: "Sofia", country: "BG" },
    }),
  );

const tree = (count: number) => (
  <ClockProvider now={NOW}>
    <MemoryRouter>
      <SessionsTable sessions={sessions(count)} caption="All sessions" />
    </MemoryRouter>
  </ClockProvider>
);

const dataRows = () =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .filter((row) => row.querySelector("a"));
const spacerHeights = () =>
  [...document.querySelectorAll<HTMLElement>('tr[data-spacer="true"]')].map((row) =>
    parseFloat(row.style.height),
  );

beforeEach(() => {
  // jsdom does no layout: every measured row is 61 px tall, in an 800 px window.
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === "TR" ? ROW : 0;
  });
  vi.stubGlobal("innerHeight", 800);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.scrollY = 0;
});

describe("SessionsTable", () => {
  it("renders a normal list in full", () => {
    render(tree(VIRTUALIZE_ROWS_ABOVE));
    expect(dataRows()).toHaveLength(VIRTUALIZE_ROWS_ABOVE);
    expect(screen.getByRole("table")).not.toHaveAttribute("data-virtual");
    expect(spacerHeights()).toEqual([]);
  });

  it("virtualises a long list: only rows near the viewport, with the height reserved", () => {
    const total = 1_000;
    render(tree(total));

    const rendered = dataRows();
    expect(screen.getByRole("table")).toHaveAttribute("data-virtual", "true");
    expect(rendered.length).toBeLessThan(40);
    expect(rendered[0]).toHaveTextContent("Visitor #0");
    // Everything below is reserved by one spacer row.
    expect(spacerHeights()).toEqual([(total - rendered.length) * ROW]);
    // The real size and position are still exposed.
    expect(screen.getByRole("table")).toHaveAttribute("aria-rowcount", String(total + 1));
    expect(rendered[0]).toHaveAttribute("aria-rowindex", "2");
  });

  it("follows the window as it scrolls", () => {
    const total = 1_000;
    render(tree(total));

    act(() => {
      window.scrollY = 500 * ROW;
      window.dispatchEvent(new Event("scroll"));
    });

    const indexes = dataRows().map((row) => Number(row.dataset.index));
    expect(indexes[0]).toBeGreaterThan(480);
    expect(indexes[0]).toBeLessThanOrEqual(500);
    expect(indexes.at(-1)).toBeGreaterThan(510);
    expect(indexes).toEqual(Array.from({ length: indexes.length }, (_, i) => indexes[0]! + i));
    const [before, after] = spacerHeights();
    expect(before).toBe(indexes[0]! * ROW);
    expect(before! + indexes.length * ROW + after!).toBe(total * ROW);
  });

  it("server-renders the top of a long list and reserves the rest", () => {
    const html = renderToString(tree(400));
    expect([...html.matchAll(/href="\/sessions\/ses_/g)]).toHaveLength(50);
    expect(html).toContain(`height:${350 * ROW}px`);
    expect(html).not.toContain("data-virtual");
  });
});
