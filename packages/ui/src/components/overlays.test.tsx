import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog.tsx";
import { Toast, ToastViewport } from "./Toast.tsx";
import { Tooltip } from "./Tooltip.tsx";

function DialogHarness({ modal = true }: { modal?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open tools
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Reliability"
        description="Inject faults"
        modal={modal}
      >
        <button type="button">Disconnect</button>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("is labelled by its title and description and mounts content only while open", async () => {
    render(<DialogHarness />);
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Open tools" }));
    const dialog = screen.getByRole("dialog", { name: "Reliability" });
    expect(dialog).toHaveAccessibleDescription("Inject faults");
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeVisible();
  });

  it.each([true, false])(
    "closes on Escape and returns focus to the opener (modal=%s)",
    async (modal) => {
      render(<DialogHarness modal={modal} />);
      const opener = screen.getByRole("button", { name: "Open tools" });
      await userEvent.click(opener);
      const dialog = screen.getByRole("dialog");
      expect(dialog).toContainElement(document.activeElement as HTMLElement);

      // Browsers turn Escape on a modal <dialog> into a `cancel` event; jsdom doesn't.
      if (modal) act(() => void dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
      else await userEvent.keyboard("{Escape}");
      expect(dialog).not.toHaveAttribute("open");
      expect(opener).toHaveFocus();
    },
  );

  it("closes from its close button", async () => {
    render(<DialogHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Open tools" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
  });
});

describe("Tooltip", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  const renderTooltip = () =>
    render(
      <Tooltip content="Cuts the socket until you reconnect">
        {(props) => (
          <button type="button" {...props}>
            Disconnect
          </button>
        )}
      </Tooltip>,
    );

  it("describes its trigger even while hidden", () => {
    renderTooltip();
    expect(screen.getByRole("button", { name: "Disconnect" })).toHaveAccessibleDescription(
      "Cuts the socket until you reconnect",
    );
    expect(screen.getByRole("tooltip", { hidden: true })).not.toBeVisible();
  });

  it("shows on keyboard focus and dismisses with Escape without moving focus", async () => {
    renderTooltip();
    await userEvent.tab();
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByRole("tooltip")).toBeVisible();

    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("tooltip", { hidden: true })).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Disconnect" })).toHaveFocus();
  });
});

describe("Toast", () => {
  it("renders inside a persistent polite live region and can be dismissed", async () => {
    const onDismiss = vi.fn();
    const onPauseChange = vi.fn();
    render(
      <ToastViewport>
        <Toast
          tone="success"
          title="Back live"
          description="Caught up on 23 events"
          onDismiss={onDismiss}
          onPauseChange={onPauseChange}
        />
      </ToastViewport>,
    );
    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region.querySelector("[aria-live=polite]")).toContainElement(
      screen.getByText("Back live"),
    );

    await userEvent.hover(screen.getByText("Back live"));
    expect(onPauseChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
