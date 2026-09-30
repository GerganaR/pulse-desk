import { describe, expect, it } from "vitest";
import {
  notificationAdded,
  notificationDismissed,
  selectNotifications,
  MAX_NOTIFICATIONS,
} from "../notifications/notifications.slice.ts";
import { createPulseStore } from "../store.ts";
import {
  connectionStateChanged,
  initialConnectionState,
  selectConnection,
  selectHighlightedReplay,
  syncCompleted,
  syncStarted,
  type ConnectionSnapshot,
} from "./connection.slice.ts";

const store = () =>
  createPulseStore({
    extra: {
      api: {
        fetchSessionsSnapshot: () => new Promise(() => {}),
        fetchSessionDetail: () => new Promise(() => {}),
      },
    },
  });

const snapshot = (patch: Partial<ConnectionSnapshot>): ConnectionSnapshot => {
  const { sync: _sync, lastReplay: _lastReplay, ...base } = initialConnectionState;
  return { ...base, ...patch };
};

describe("connection slice", () => {
  it("records the last replay range and highlights only non-initial replays", () => {
    const s = store();
    s.dispatch(syncStarted({ fromSequence: 5, toSequence: 7, reason: "initial" }));
    s.dispatch(syncCompleted({ replayedCount: 3 }));
    expect(selectHighlightedReplay(s.getState())).toBeNull();

    s.dispatch(syncStarted({ fromSequence: 8, toSequence: 30, reason: "reconnect" }));
    expect(selectConnection(s.getState()).sync).toMatchObject({ fromSequence: 8, toSequence: 30 });
    s.dispatch(syncCompleted({ replayedCount: 23 }));
    expect(selectConnection(s.getState()).sync).toBeNull();
    expect(selectHighlightedReplay(s.getState())).toEqual({
      fromSequence: 8,
      toSequence: 30,
      reason: "reconnect",
      count: 23,
    });
  });

  it("an empty replay isn't highlighted", () => {
    const s = store();
    s.dispatch(syncStarted({ fromSequence: 8, toSequence: 7, reason: "reconnect" }));
    s.dispatch(syncCompleted({ replayedCount: 0 }));
    expect(selectHighlightedReplay(s.getState())).toBeNull();
  });

  it("losing the connection mid-sync clears the in-progress sync", () => {
    const s = store();
    s.dispatch(syncStarted({ fromSequence: 1, toSequence: 9, reason: "reconnect" }));
    s.dispatch(connectionStateChanged(snapshot({ status: "reconnecting", disconnectedAt: 1 })));
    expect(selectConnection(s.getState())).toMatchObject({
      status: "reconnecting",
      sync: null,
      disconnectedAt: 1,
    });
  });
});

describe("notifications slice", () => {
  it("adds with an id and time, dismisses by id, and keeps only the most recent few", () => {
    const s = store();
    for (let i = 0; i < MAX_NOTIFICATIONS + 2; i++)
      s.dispatch(notificationAdded({ tone: "info", title: `n${i}` }));
    const items = selectNotifications(s.getState());
    expect(items.map((n) => n.title)).toEqual(["n2", "n3", "n4"]);
    expect(items[0]).toMatchObject({ description: null, id: expect.any(String) });

    s.dispatch(notificationDismissed(items[0]!.id));
    expect(selectNotifications(s.getState()).map((n) => n.title)).toEqual(["n3", "n4"]);
  });
});
