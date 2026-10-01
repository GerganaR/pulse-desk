import {
  connectionStateChanged,
  createPulseStore,
  initialConnectionState,
  type ConnectionState,
} from "@pulsedesk/state";
import { ConnectionIndicator } from "@pulsedesk/ui";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClockProvider } from "@/lib/clock";
import { LiveConnectionIndicator, toIndicatorStatus } from "./LiveConnectionIndicator";
import { OutageNotice } from "./OutageBanner";
import { PROLONGED_OUTAGE_MS } from "./outage";

const NOW = 1_760_000_000_000;
const connection = (patch: Partial<ConnectionState>): ConnectionState => ({
  ...initialConnectionState,
  ...patch,
});

describe("toIndicatorStatus", () => {
  it.each<[string, Partial<ConnectionState>, string]>([
    ["first connection", { status: "connecting" }, "connecting"],
    ["first sync after page load", { status: "syncing" }, "connecting"],
    ["live", { status: "live", liveSince: NOW }, "live"],
    ["live but slow", { status: "live", degraded: true, rttMs: 1_800 }, "degraded"],
    ["waiting to retry", { status: "reconnecting", reconnectAttempt: 2 }, "reconnecting"],
    ["reopening after a drop", { status: "connecting", reconnectAttempt: 1 }, "reconnecting"],
    [
      "replaying after a reconnect",
      { status: "syncing", sync: { fromSequence: 5, toSequence: 27, reason: "reconnect" } },
      "syncing",
    ],
    ["resyncing a gap on a live socket", { status: "syncing", liveSince: NOW }, "syncing"],
    ["browser offline", { status: "reconnecting", network: "offline" }, "offline"],
    ["closed", { status: "closed" }, "offline"],
  ])("%s → %s", (_, patch, expected) => {
    expect(toIndicatorStatus(connection(patch))).toBe(expected);
  });

  it("stays Live while the socket still works, even if the OS says offline", () => {
    expect(toIndicatorStatus(connection({ status: "live", network: "offline" }))).toBe("live");
  });
});

describe("ConnectionIndicator labels", () => {
  it("reads 'Catching up' with the event count as detail", () => {
    render(<ConnectionIndicator status="syncing" detail="23 events" />);
    expect(screen.getByRole("status")).toHaveTextContent("Catching up");
    expect(screen.getByText("23 events")).toBeInTheDocument();
  });
});

describe("LiveConnectionIndicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  function renderIndicator(patch: Partial<ConnectionState>) {
    const store = createPulseStore({
      preloadedState: { connection: connection(patch) },
      extra: {
        api: {
          fetchSessionsSnapshot: () => new Promise(() => {}),
          fetchSessionDetail: () => new Promise(() => {}),
        },
      },
    });
    const { container } = render(
      <Provider store={store}>
        <ClockProvider now={NOW}>
          <LiveConnectionIndicator />
        </ClockProvider>
      </Provider>,
    );
    const pill = container.querySelector("[data-status]")!;
    return {
      store,
      pill,
      /** The muted text after the label; it's hidden from the live region. */
      detail: () => pill.querySelector('[aria-hidden="true"]:not(svg):last-child')?.textContent,
    };
  }

  // Every state the pill can show, with the label a screen reader hears and the detail
  // a sighted user sees next to it.
  it.each<[string, Partial<ConnectionState>, string, string, string | undefined]>([
    ["before the socket opens", { status: "idle" }, "connecting", "Connecting", undefined],
    ["first connection", { status: "connecting" }, "connecting", "Connecting", undefined],
    ["live", { status: "live", liveSince: NOW, rttMs: 40 }, "live", "Live", undefined],
    [
      "slow, with a measured round trip",
      { status: "live", degraded: true, rttMs: 1_800 },
      "degraded",
      "Degraded",
      "1.8 s",
    ],
    [
      "slow, before any round trip finished",
      { status: "live", degraded: true, rttMs: null },
      "degraded",
      "Degraded",
      "slow",
    ],
    [
      "waiting to retry",
      { status: "reconnecting", reconnectAttempt: 2, nextRetryAt: NOW + 4_000 },
      "reconnecting",
      "Reconnecting",
      "retry in 4s",
    ],
    [
      "retry due",
      { status: "reconnecting", reconnectAttempt: 2, nextRetryAt: NOW },
      "reconnecting",
      "Reconnecting",
      "retrying…",
    ],
    [
      "no retry scheduled",
      { status: "reconnecting", reconnectAttempt: 1, nextRetryAt: null },
      "reconnecting",
      "Reconnecting",
      "waiting for network",
    ],
    [
      "reopening the socket after a drop",
      { status: "connecting", reconnectAttempt: 3 },
      "reconnecting",
      "Reconnecting",
      undefined,
    ],
    [
      "replaying what was missed",
      {
        status: "syncing",
        reconnectAttempt: 1,
        sync: { fromSequence: 5, toSequence: 27, reason: "reconnect" },
      },
      "syncing",
      "Catching up",
      "23 events",
    ],
    [
      "replaying a single event",
      {
        status: "syncing",
        liveSince: NOW,
        sync: { fromSequence: 9, toSequence: 9, reason: "resync" },
      },
      "syncing",
      "Catching up",
      "1 event",
    ],
    [
      "browser offline",
      { status: "reconnecting", network: "offline", nextRetryAt: null },
      "offline",
      "Offline",
      "no network",
    ],
    ["closed for good", { status: "closed" }, "offline", "Offline", undefined],
  ])("%s", (_, patch, status, label, detail) => {
    const view = renderIndicator(patch);
    expect(view.pill).toHaveAttribute("data-status", status);
    expect(screen.getByRole("status")).toHaveTextContent(new RegExp(`^${label}$`));
    expect(view.detail()).toBe(detail);
  });

  it("counts the retry down every second without re-announcing the status", () => {
    const view = renderIndicator({
      status: "reconnecting",
      reconnectAttempt: 1,
      nextRetryAt: NOW + 3_000,
    });
    expect(view.detail()).toBe("retry in 3s");
    act(() => void vi.advanceTimersByTime(2_000));
    expect(view.detail()).toBe("retry in 1s");
    act(() => void vi.advanceTimersByTime(1_000));
    expect(view.detail()).toBe("retrying…");
    expect(screen.getByRole("status")).toHaveTextContent(/^Reconnecting$/);
  });

  it("follows the connection as it drops, catches up and goes live again", () => {
    const view = renderIndicator({ status: "live", liveSince: NOW });
    const snapshot = { ...initialConnectionState, liveSince: null };
    const status = () => view.pill.getAttribute("data-status");

    act(() => {
      view.store.dispatch(
        connectionStateChanged({
          ...snapshot,
          status: "reconnecting",
          reconnectAttempt: 1,
          nextRetryAt: NOW + 1_000,
          disconnectedAt: NOW,
        }),
      );
    });
    expect(status()).toBe("reconnecting");

    act(() => {
      view.store.dispatch(
        connectionStateChanged({ ...snapshot, status: "connecting", reconnectAttempt: 1 }),
      );
    });
    expect(status(), "still a reconnect, not a fresh connection").toBe("reconnecting");

    act(() => {
      view.store.dispatch(
        connectionStateChanged({ ...snapshot, status: "live", liveSince: NOW + 1_500 }),
      );
    });
    expect(status()).toBe("live");
    expect(view.detail()).toBeUndefined();
  });
});

describe("OutageNotice", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  const renderNotice = (patch: Partial<ConnectionState>, onRetry = vi.fn()) =>
    render(
      <ClockProvider now={NOW}>
        <OutageNotice connection={connection(patch)} onRetry={onRetry} />
      </ClockProvider>,
    );

  it("stays hidden for a short blip", () => {
    renderNotice({ status: "reconnecting", disconnectedAt: NOW - PROLONGED_OUTAGE_MS + 1_000 });
    expect(screen.queryByTestId("outage-banner")).toBeNull();
  });

  it("appears after a prolonged outage and offers a manual retry", async () => {
    const onRetry = vi.fn();
    renderNotice(
      { status: "reconnecting", disconnectedAt: NOW - 42_000, nextRetryAt: NOW + 8_000 },
      onRetry,
    );
    expect(screen.getByTestId("outage-banner")).toHaveTextContent("Live updates paused");
    expect(screen.getByTestId("outage-banner")).toHaveTextContent("for 42s");
    await userEvent.click(screen.getByRole("button", { name: /Retry now \(8s\)/ }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("says so when the browser is offline", () => {
    renderNotice({ status: "reconnecting", network: "offline", disconnectedAt: NOW - 60_000 });
    expect(screen.getByTestId("outage-banner")).toHaveTextContent("You're offline");
  });

  it("is gone as soon as the connection is live again", () => {
    renderNotice({ status: "live", disconnectedAt: null });
    expect(screen.queryByTestId("outage-banner")).toBeNull();
  });

  it("is not shown once the client has given up: there is nothing to retry", () => {
    renderNotice({ status: "closed", disconnectedAt: NOW - 60_000 });
    expect(screen.queryByTestId("outage-banner")).toBeNull();
  });

  it("disables Retry while an attempt is already in flight", () => {
    renderNotice({
      status: "connecting",
      reconnectAttempt: 4,
      disconnectedAt: NOW - 30_000,
      nextRetryAt: null,
    });
    expect(screen.getByRole("button", { name: "Retry now" })).toBeDisabled();
  });

  it("drops the countdown from the button once the retry is due", () => {
    renderNotice({ status: "reconnecting", disconnectedAt: NOW - 30_000, nextRetryAt: NOW });
    expect(screen.getByRole("button", { name: "Retry now" })).toBeEnabled();
  });

  it("is a polite status, so it doesn't interrupt what is being read", () => {
    renderNotice({ status: "reconnecting", disconnectedAt: NOW - 30_000 });
    expect(screen.getByTestId("outage-banner")).toHaveAttribute("role", "status");
  });
});
