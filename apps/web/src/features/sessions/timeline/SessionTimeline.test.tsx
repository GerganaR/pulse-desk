import type { RealtimeEvent } from "@pulsedesk/contracts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionTimeline, VIRTUALIZE_ABOVE } from "./SessionTimeline";

const STARTED_AT = 1_760_000_000_000;
const VIEWPORT = 600;
/** Row heights the component promises: a page view has a detail line, a form open doesn't. */
const WITH_DETAIL = 56;
const PLAIN = 44;

const pageView = (sequence: number): RealtimeEvent => ({
  eventId: `evt_${sequence}`,
  sequence,
  sessionId: "ses_1",
  timestamp: STARTED_AT + sequence * 1_000,
  type: "session.page_view",
  payload: { path: `/page/${sequence}`, title: `Page ${sequence}` },
});

const formOpen = (sequence: number): RealtimeEvent => ({
  eventId: `evt_${sequence}`,
  sequence,
  sessionId: "ses_1",
  timestamp: STARTED_AT + sequence * 1_000,
  type: "session.form_open",
  payload: { formId: "signup", path: "/signup" },
});

const pageViews = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => pageView(from + i));

/**
 * jsdom does no layout. Give the scroll container a viewport and a content height that
 * follows what is rendered, which is all the component reads.
 */
function mockLayout() {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset.testid === "timeline-scroll" ? VIEWPORT : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset.testid === "timeline-scroll" ? VIEWPORT : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    const list = this.querySelector("ol");
    if (!list) return 0;
    // 16 px above the list, then the list: its explicit height when virtual, else rows.
    if (list.style.height) return 16 + parseFloat(list.style.height);
    const rows = [...list.querySelectorAll("li")];
    const padding = parseFloat(list.style.paddingTop || "0");
    return (
      16 +
      padding +
      rows.reduce((sum, row) => sum + (row.classList.contains("h-14") ? WITH_DETAIL : PLAIN), 0)
    );
  });
}

const scroller = () => screen.getByTestId("timeline-scroll");
const rows = () =>
  within(screen.getByRole("list", { name: "Session activity" })).getAllByRole("listitem");
const sequences = () => rows().map((row) => Number(row.dataset.sequence));

function scrollTo(top: number) {
  scroller().scrollTop = top;
  fireEvent.scroll(scroller());
}

beforeEach(mockLayout);
afterEach(() => vi.restoreAllMocks());

describe("SessionTimeline", () => {
  it("renders a short timeline in full, in order", () => {
    render(<SessionTimeline events={pageViews(1, 30)} startedAt={STARTED_AT} truncated={false} />);
    expect(sequences()).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(screen.getByRole("list")).not.toHaveAttribute("data-virtual");
  });

  it("can be focused, so the keyboard can scroll it (its rows hold nothing to tab to)", () => {
    render(<SessionTimeline events={pageViews(1, 30)} startedAt={STARTED_AT} truncated={false} />);
    expect(screen.getByRole("group", { name: "Activity timeline" })).toBe(scroller());
    expect(scroller()).toHaveAttribute("tabindex", "0");
  });

  it("hides events that have no presentation (stopped typing)", () => {
    const stopped: RealtimeEvent = {
      ...pageView(2),
      type: "session.typing",
      payload: { formId: "signup", field: "email", isTyping: false },
    };
    render(
      <SessionTimeline
        events={[pageView(1), stopped, pageView(3)]}
        startedAt={STARTED_AT}
        truncated={false}
      />,
    );
    expect(sequences()).toEqual([1, 3]);
  });

  it("virtualises a long timeline: only rows near the viewport are in the DOM", () => {
    const total = 2_000;
    render(
      <SessionTimeline events={pageViews(1, total)} startedAt={STARTED_AT} truncated={false} />,
    );
    const list = screen.getByRole("list", { name: "Session activity" });
    expect(list).toHaveAttribute("data-virtual", "true");
    expect(list.style.height).toBe(`${total * WITH_DETAIL}px`);

    const shown = sequences();
    expect(shown.length).toBeLessThan(40);
    // Following the live edge: the newest entry is rendered, and rows are contiguous.
    expect(shown.at(-1)).toBe(total);
    expect(shown).toEqual(Array.from({ length: shown.length }, (_, i) => shown[0]! + i));
    // Assistive technology still learns the real size and position.
    expect(rows().at(-1)).toHaveAttribute("aria-setsize", String(total));
    expect(rows().at(-1)).toHaveAttribute("aria-posinset", String(total));
  });

  it("places virtual rows by their fixed heights (mixed one- and two-line rows)", () => {
    const events = Array.from({ length: 300 }, (_, i) =>
      i % 3 === 0 ? formOpen(i + 1) : pageView(i + 1),
    );
    render(<SessionTimeline events={events} startedAt={STARTED_AT} truncated={false} />);
    const offsetOf = (sequence: number) =>
      events
        .slice(0, sequence - 1)
        .reduce((sum, e) => sum + (e.type === "session.form_open" ? PLAIN : WITH_DETAIL), 0);

    for (const row of rows()) {
      const sequence = Number(row.dataset.sequence);
      expect(row.style.top).toBe(`${offsetOf(sequence)}px`);
      // Never a transform: the fade-in animation would override it (see the component).
      expect(row.style.transform).toBe("");
    }
    expect(screen.getByRole("list").style.height).toBe(`${offsetOf(301)}px`);
  });

  it("follows new events while the reader is at the bottom", () => {
    const { rerender } = render(
      <SessionTimeline events={pageViews(1, 20)} startedAt={STARTED_AT} truncated={false} />,
    );
    expect(scroller().scrollTop).toBe(16 + 20 * WITH_DETAIL);

    rerender(
      <SessionTimeline events={pageViews(1, 25)} startedAt={STARTED_AT} truncated={false} />,
    );

    expect(scroller().scrollTop).toBe(16 + 25 * WITH_DETAIL);
    expect(screen.queryByRole("button", { name: /new event/ })).toBeNull();
  });

  it("stays put when the reader has scrolled up, and offers the way back", () => {
    const { rerender } = render(
      <SessionTimeline events={pageViews(1, 60)} startedAt={STARTED_AT} truncated={false} />,
    );
    scrollTo(200);

    rerender(
      <SessionTimeline events={pageViews(1, 63)} startedAt={STARTED_AT} truncated={false} />,
    );

    expect(scroller().scrollTop).toBe(200);
    const button = screen.getByRole("button", { name: "3 new events" });

    fireEvent.click(button);

    expect(scroller().scrollTop).toBe(16 + 63 * WITH_DETAIL);
    expect(screen.queryByRole("button", { name: /new event/ })).toBeNull();
  });

  it("counts a single new event in the singular", () => {
    const { rerender } = render(
      <SessionTimeline events={pageViews(1, 60)} startedAt={STARTED_AT} truncated={false} />,
    );
    scrollTo(200);
    rerender(
      <SessionTimeline events={pageViews(1, 61)} startedAt={STARTED_AT} truncated={false} />,
    );
    expect(screen.getByRole("button", { name: "1 new event" })).toBeInTheDocument();
  });

  it("resumes following once the reader scrolls back to the bottom", () => {
    const { rerender } = render(
      <SessionTimeline events={pageViews(1, 60)} startedAt={STARTED_AT} truncated={false} />,
    );
    scrollTo(200);
    rerender(
      <SessionTimeline events={pageViews(1, 62)} startedAt={STARTED_AT} truncated={false} />,
    );
    expect(screen.getByRole("button", { name: "2 new events" })).toBeInTheDocument();

    scrollTo(16 + 62 * WITH_DETAIL - VIEWPORT);

    expect(screen.queryByRole("button", { name: /new event/ })).toBeNull();
    rerender(
      <SessionTimeline events={pageViews(1, 64)} startedAt={STARTED_AT} truncated={false} />,
    );
    expect(scroller().scrollTop).toBe(16 + 64 * WITH_DETAIL);
  });

  it("keeps the reader's place when old entries are trimmed above it", () => {
    const { rerender } = render(
      <SessionTimeline events={pageViews(1, 300)} startedAt={STARTED_AT} truncated={false} />,
    );
    scrollTo(5_000);

    // The per-session cap drops the three oldest entries as three new ones arrive, and
    // the "earlier activity" note (32 px) appears above the list.
    rerender(<SessionTimeline events={pageViews(4, 303)} startedAt={STARTED_AT} truncated />);

    expect(scroller().scrollTop).toBe(5_000 - 3 * WITH_DETAIL + 32);
    expect(screen.getByText("Earlier activity isn't shown")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3 new events" })).toBeInTheDocument();
  });

  const fading = () =>
    rows()
      .filter((row) => row.className.includes("animate-fade-in"))
      .map((row) => Number(row.dataset.sequence));

  it("fades in what just arrived, and only that", () => {
    const { rerender } = render(
      <SessionTimeline events={pageViews(1, 20)} startedAt={STARTED_AT} truncated={false} />,
    );
    expect(fading()).toEqual([]);

    rerender(
      <SessionTimeline events={pageViews(1, 22)} startedAt={STARTED_AT} truncated={false} />,
    );
    expect(fading()).toEqual([21, 22]);

    // The next update: the earlier arrivals are no longer new.
    rerender(
      <SessionTimeline events={pageViews(1, 23)} startedAt={STARTED_AT} truncated={false} />,
    );
    expect(fading()).toEqual([23]);
  });

  it("doesn't animate a flood: more than a few rows at once just appear", () => {
    const { rerender } = render(
      <SessionTimeline events={pageViews(1, 20)} startedAt={STARTED_AT} truncated={false} />,
    );
    rerender(
      <SessionTimeline events={pageViews(1, 60)} startedAt={STARTED_AT} truncated={false} />,
    );
    expect(fading()).toEqual([]);
    expect(sequences().at(-1)).toBe(60);
  });

  it("tints events replayed while the page was open, however many arrive at once", () => {
    const { rerender } = render(
      <SessionTimeline events={pageViews(1, 10)} startedAt={STARTED_AT} truncated={false} />,
    );
    rerender(
      <SessionTimeline
        events={pageViews(1, 30)}
        startedAt={STARTED_AT}
        truncated={false}
        replayed={{ fromSequence: 9, toSequence: 30 }}
      />,
    );
    const tinted = rows()
      .filter((row) => row.querySelector(".animate-replay-highlight"))
      .map((row) => Number(row.dataset.sequence));
    // 9 and 10 were on screen before the replay; 11 to 30 came with it.
    expect(tinted).toEqual(Array.from({ length: 20 }, (_, i) => 11 + i));
  });

  it("marks replayed events", () => {
    render(
      <SessionTimeline
        events={pageViews(1, 10)}
        startedAt={STARTED_AT}
        truncated={false}
        replayed={{ fromSequence: 8, toSequence: 9 }}
      />,
    );
    const replayed = rows().filter((row) => row.dataset.replayed === "true");
    expect(replayed.map((row) => Number(row.dataset.sequence))).toEqual([8, 9]);
  });

  it("server-renders the latest entries of a long timeline, and says earlier ones are hidden", () => {
    const html = renderToString(
      <SessionTimeline events={pageViews(1, 250)} startedAt={STARTED_AT} truncated={false} />,
    );
    const rendered = [...html.matchAll(/data-sequence="(\d+)"/g)].map((m) => Number(m[1]));

    expect(rendered).toHaveLength(VIRTUALIZE_ABOVE);
    expect(rendered[0]).toBe(151);
    expect(rendered.at(-1)).toBe(250);
    expect(html).toContain("Earlier activity isn&#x27;t shown");
    expect(html).not.toContain("data-virtual");
  });

  it("server-renders a short timeline completely", () => {
    const html = renderToString(
      <SessionTimeline events={pageViews(1, 40)} startedAt={STARTED_AT} truncated={false} />,
    );
    expect([...html.matchAll(/data-sequence=/g)]).toHaveLength(40);
    expect(html).not.toContain("Earlier activity");
  });
});
