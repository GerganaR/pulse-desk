import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "./DropdownMenu.tsx";

function Harness({ onSignOut = vi.fn() }: { onSignOut?: () => void }) {
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  return (
    <>
      <DropdownMenu trigger="Account" triggerLabel="Account menu">
        <DropdownMenuRadioGroup label="Theme" value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuItem onSelect={onSignOut}>Sign out</DropdownMenuItem>
      </DropdownMenu>
      <output data-testid="theme">{theme}</output>
      <button type="button">Elsewhere</button>
    </>
  );
}

const trigger = () => screen.getByRole("button", { name: "Account menu" });

describe("DropdownMenu", () => {
  it("is closed by default and advertises its popup", () => {
    render(<Harness />);
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens from the keyboard and focuses the first item", async () => {
    render(<Harness />);
    trigger().focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitemradio", { name: "System" })).toHaveFocus();
  });

  it("ArrowUp on the trigger focuses the last item", async () => {
    render(<Harness />);
    trigger().focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
  });

  it("moves focus with arrows, wraps, and supports Home/End", async () => {
    render(<Harness />);
    await userEvent.click(trigger());
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: "System" })).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("menuitemradio", { name: "System" })).toHaveFocus();
  });

  it("selects a radio item, reflects aria-checked, closes and restores focus", async () => {
    render(<Harness />);
    await userEvent.click(trigger());
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();

    await userEvent.click(trigger());
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    render(<Harness />);
    await userEvent.click(trigger());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("closes on outside press without stealing focus", async () => {
    render(<Harness />);
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });

  it("runs the action of a plain item", async () => {
    const onSignOut = vi.fn();
    render(<Harness onSignOut={onSignOut} />);
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
