import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Tab, TabList, TabPanel, Tabs } from "./Tabs.tsx";

function Harness({ onValueChange }: { onValueChange?: (value: string) => void }) {
  return (
    <Tabs defaultValue="activity" onValueChange={onValueChange}>
      <TabList aria-label="Session views">
        <Tab value="details">Details</Tab>
        <Tab value="activity">Activity</Tab>
        <Tab value="copilot">Copilot</Tab>
      </TabList>
      <TabPanel value="details">Details panel</TabPanel>
      <TabPanel value="activity" forceMount>
        Activity panel
      </TabPanel>
      <TabPanel value="copilot" forceMount>
        Copilot panel
      </TabPanel>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("links tabs and panels, and marks the selected tab", () => {
    render(<Harness />);
    const tablist = screen.getByRole("tablist", { name: "Session views" });
    expect(tablist).toBeInTheDocument();
    const activity = screen.getByRole("tab", { name: "Activity" });
    expect(activity).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "false");
    const panel = screen.getByRole("tabpanel", { name: "Activity" });
    expect(panel).toHaveTextContent("Activity panel");
    expect(activity).toHaveAttribute("aria-controls", panel.id);
  });

  it("uses a roving tabindex: only the selected tab is tabbable", () => {
    render(<Harness />);
    expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("tabindex"))).toEqual([
      "-1",
      "0",
      "-1",
    ]);
  });

  it("moves focus and selection with arrow keys, Home and End (wrapping)", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);
    await user.tab();
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Copilot" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Copilot" })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Details" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Copilot" })).toHaveFocus();
    await user.keyboard("{Home}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Copilot" })).toHaveFocus();
    expect(onValueChange.mock.calls.map(([value]) => value as string)).toEqual([
      "copilot",
      "details",
      "copilot",
      "details",
      "copilot",
    ]);
  });

  it("unmounts inactive panels unless forceMount keeps them (marked inactive)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByText("Details panel")).not.toBeInTheDocument();
    expect(screen.getByText("Copilot panel")).toHaveAttribute("data-state", "inactive");

    await user.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("Details panel")).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Activity panel")).toHaveAttribute("data-state", "inactive");
  });
});
