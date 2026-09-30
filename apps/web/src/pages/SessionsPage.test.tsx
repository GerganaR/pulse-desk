import { createPulseStore, snapshotReceived } from "@pulsedesk/state";
import { makeSession } from "@pulsedesk/test-utils";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { ClockProvider } from "@/lib/clock";
import { SessionsPage } from "./SessionsPage";

const now = 1_760_000_000_000;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderPage(initialUrl = "/sessions") {
  const store = createPulseStore({
    extra: {
      api: {
        fetchSessionsSnapshot: () => new Promise(() => {}),
        fetchSessionDetail: () => new Promise(() => {}),
      },
    },
  });
  store.dispatch(
    snapshotReceived({
      streamId: "stream-1",
      sequence: 1,
      sessions: [
        makeSession({
          id: "s1",
          status: "active",
          lastActivityAt: now - 1_000,
          currentPath: "/pricing",
          visitor: {
            id: "v1",
            label: "Visitor #1001",
            name: "Amara",
            city: "Lagos",
            country: "NG",
          },
        }),
        makeSession({
          id: "s2",
          status: "idle",
          lastActivityAt: now - 60_000,
          currentPath: "/docs/getting-started",
          visitor: { id: "v2", label: "Visitor #1002", name: null, city: "Berlin", country: "DE" },
        }),
        makeSession({
          id: "s3",
          status: "closed",
          lastActivityAt: now - 600_000,
          endedAt: now - 600_000,
          currentPath: "/checkout",
          visitor: { id: "v3", label: "Visitor #1003", name: null, city: "Tokyo", country: "JP" },
        }),
      ],
    }),
  );
  render(
    <Provider store={store}>
      <ClockProvider now={now}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <Routes>
            <Route path="/sessions" element={<SessionsPage />} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </ClockProvider>
    </Provider>,
  );
}

const rowNames = () =>
  within(screen.getByRole("table"))
    .getAllByRole("link")
    .map((link) => link.textContent);

describe("SessionsPage", () => {
  it("lists sessions most recently active first", () => {
    renderPage();
    expect(rowNames()).toEqual(["Amara", "Visitor #1002", "Visitor #1003"]);
  });

  it("filters by status through the URL", async () => {
    renderPage();
    const filters = screen.getByRole("navigation", { name: "Filter by status" });
    await userEvent.click(within(filters).getByRole("link", { name: /Idle/ }));

    expect(screen.getByTestId("location")).toHaveTextContent("/sessions?status=idle");
    expect(within(filters).getByRole("link", { name: /Idle/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(rowNames()).toEqual(["Visitor #1002"]);
  });

  it("restores filters from the URL (shareable links, reloads)", () => {
    renderPage("/sessions?status=closed");
    expect(rowNames()).toEqual(["Visitor #1003"]);
  });

  it("ignores invalid filter values instead of rendering nothing", () => {
    renderPage("/sessions?status=<script>");
    expect(rowNames()).toHaveLength(3);
  });

  it("searches by city, name or page", async () => {
    renderPage();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search sessions" }), "berlin");
    expect(screen.getByTestId("location")).toHaveTextContent("q=berlin");
    expect(rowNames()).toEqual(["Visitor #1002"]);
  });

  it("explains an empty result and offers a way out", async () => {
    renderPage("/sessions?status=active&q=nomatch");
    expect(screen.getByText("No matching sessions")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Clear filters" }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/sessions$/);
    expect(rowNames()).toHaveLength(3);
  });
});
