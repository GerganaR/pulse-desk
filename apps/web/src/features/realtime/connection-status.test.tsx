import { initialConnectionState, type ConnectionState } from "@pulsedesk/state";
import { ConnectionIndicator } from "@pulsedesk/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClockProvider } from "@/lib/clock";
import { toIndicatorStatus } from "./LiveConnectionIndicator";
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
});
