import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindBrowserLifecycle } from "./browser-lifecycle.ts";

/**
 * The browser signals the socket can't see for itself. The package's tests run in Node,
 * so `window`, `document` and `navigator` are stand-ins that dispatch the real events.
 */
const T0 = 1_760_000_000_000;

function browser({ onLine = true, hidden = false } = {}) {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { hidden });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", { onLine });
  return {
    goOffline: () => window.dispatchEvent(new Event("offline")),
    goOnline: () => window.dispatchEvent(new Event("online")),
    hide() {
      document.hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    },
    show() {
      document.hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

const client = () => ({
  setNetworkStatus: vi.fn(),
  reconnectNow: vi.fn(),
  checkConnection: vi.fn(),
});

beforeEach(() => vi.useFakeTimers({ now: T0 }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("browser lifecycle", () => {
  it("does nothing outside a browser", () => {
    const realtime = client();
    const unbind = bindBrowserLifecycle(realtime);
    expect(() => unbind()).not.toThrow();
    expect(realtime.setNetworkStatus).not.toHaveBeenCalled();
  });

  it("tells the client when the network goes away and comes back", () => {
    const page = browser();
    const realtime = client();
    bindBrowserLifecycle(realtime);
    expect(realtime.setNetworkStatus).not.toHaveBeenCalled();

    page.goOffline();
    expect(realtime.setNetworkStatus).toHaveBeenLastCalledWith(false);
    page.goOnline();
    expect(realtime.setNetworkStatus).toHaveBeenLastCalledWith(true);
  });

  it("starts offline when the page loads without a network", () => {
    browser({ onLine: false });
    const realtime = client();
    bindBrowserLifecycle(realtime);
    expect(realtime.setNetworkStatus).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("checks the connection at once when a tab returns after being hidden a while", () => {
    const page = browser();
    const realtime = client();
    bindBrowserLifecycle(realtime, { hiddenCheckAfterMs: 5_000 });

    page.hide();
    vi.advanceTimersByTime(5_000);
    expect(realtime.checkConnection).not.toHaveBeenCalled(); // nothing while hidden
    page.show();

    expect(realtime.reconnectNow).toHaveBeenCalledOnce();
    expect(realtime.checkConnection).toHaveBeenCalledOnce();
  });

  it("leaves the connection alone after a quick tab switch", () => {
    const page = browser();
    const realtime = client();
    bindBrowserLifecycle(realtime, { hiddenCheckAfterMs: 5_000 });

    page.hide();
    vi.advanceTimersByTime(4_999);
    page.show();
    page.show(); // a second "visible" with no hide in between counts as no time hidden

    expect(realtime.reconnectNow).not.toHaveBeenCalled();
    expect(realtime.checkConnection).not.toHaveBeenCalled();
  });

  it("counts time hidden from page load for a tab that opened in the background", () => {
    const page = browser({ hidden: true });
    const realtime = client();
    bindBrowserLifecycle(realtime);
    vi.advanceTimersByTime(60_000);
    page.show();
    expect(realtime.checkConnection).toHaveBeenCalledOnce();
  });

  it("stops listening once unbound", () => {
    const page = browser();
    const realtime = client();
    const unbind = bindBrowserLifecycle(realtime);
    unbind();

    page.goOffline();
    page.hide();
    vi.advanceTimersByTime(60_000);
    page.show();

    expect(realtime.setNetworkStatus).not.toHaveBeenCalled();
    expect(realtime.checkConnection).not.toHaveBeenCalled();
  });
});
