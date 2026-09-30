import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { initialsOf } from "./Avatar.tsx";
import { Button } from "./Button.tsx";
import { ConnectionIndicator } from "./ConnectionIndicator.tsx";
import { ErrorState } from "./ErrorState.tsx";
import { Input } from "./Input.tsx";

describe("Button", () => {
  it("defaults to type=button so it never submits a surrounding form by accident", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "button");
  });

  it("blocks interaction and exposes aria-busy while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Generate
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Generate" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("is keyboard operable", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Retry</Button>);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Retry" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("ConnectionIndicator", () => {
  it("announces the status label through a polite live region", () => {
    render(<ConnectionIndicator status="reconnecting" detail="retry in 4s" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Reconnecting");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("keeps ticking detail text out of the live region", () => {
    render(<ConnectionIndicator status="live" detail="42 ms" />);
    expect(screen.getByRole("status")).not.toHaveTextContent("42 ms");
    expect(screen.getByText("42 ms")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("ErrorState", () => {
  it("is announced as an alert", () => {
    render(
      <ErrorState inline title="Generation failed" description="The AI service returned 500." />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Generation failed");
  });
});

describe("Input", () => {
  it("reflects invalid state to assistive tech", () => {
    render(<Input aria-label="Email" invalid />);
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveAttribute("aria-invalid", "true");
  });
});

describe("initialsOf", () => {
  it.each([
    ["Sofia Petrova", "SP"],
    ["sofia", "S"],
    ["Visitor #3291", "V"],
    ["#3291", "91"],
  ])("%s → %s", (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });
});
