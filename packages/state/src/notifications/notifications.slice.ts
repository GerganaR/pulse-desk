import { createSlice, nanoid, type PayloadAction } from "@reduxjs/toolkit";

export type NotificationTone = "info" | "success" | "warning" | "error";

export interface AppNotification {
  id: string;
  tone: NotificationTone;
  title: string;
  description: string | null;
  createdAt: number;
}

export interface NotificationsState {
  items: AppNotification[];
}

/** Older notifications are dropped past this: toasts are for the moment, not a log. */
export const MAX_NOTIFICATIONS = 3;

export const initialNotificationsState: NotificationsState = { items: [] };

export const notificationsSlice = createSlice({
  name: "notifications",
  initialState: initialNotificationsState,
  reducers: {
    notificationAdded: {
      reducer(state, action: PayloadAction<AppNotification>) {
        state.items.push(action.payload);
        if (state.items.length > MAX_NOTIFICATIONS)
          state.items.splice(0, state.items.length - MAX_NOTIFICATIONS);
      },
      // Id and time are assigned here, outside the reducer, so reducers stay pure.
      prepare(input: { tone: NotificationTone; title: string; description?: string }) {
        return {
          payload: {
            id: nanoid(),
            tone: input.tone,
            title: input.title,
            description: input.description ?? null,
            createdAt: Date.now(),
          },
        };
      },
    },
    notificationDismissed(state, action: PayloadAction<string>) {
      state.items = state.items.filter((item) => item.id !== action.payload);
    },
  },
});

export const { notificationAdded, notificationDismissed } = notificationsSlice.actions;
export const selectNotifications = (state: { notifications: NotificationsState }) =>
  state.notifications.items;
