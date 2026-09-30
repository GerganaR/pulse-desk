import { notificationDismissed, selectNotifications, type AppNotification } from "@pulsedesk/state";
import { Toast, ToastViewport, type ToastTone } from "@pulsedesk/ui";
import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";

const AUTO_DISMISS_MS = 6_000;

const tones: Record<AppNotification["tone"], ToastTone> = {
  info: "info",
  success: "success",
  warning: "warning",
  error: "danger",
};

function AutoDismissToast({ notification }: { notification: AppNotification }) {
  const dispatch = useAppDispatch();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    // Restarts in full after a pause: a message someone was reading gets a fresh window.
    const timer = setTimeout(
      () => dispatch(notificationDismissed(notification.id)),
      AUTO_DISMISS_MS,
    );
    return () => clearTimeout(timer);
  }, [dispatch, notification.id, paused]);

  return (
    <Toast
      tone={tones[notification.tone]}
      title={notification.title}
      description={notification.description ?? undefined}
      onDismiss={() => dispatch(notificationDismissed(notification.id))}
      onPauseChange={setPaused}
    />
  );
}

/** Renders app notifications (the `notifications` slice) as auto-dismissing toasts. */
export function Toaster() {
  const notifications = useAppSelector(selectNotifications);
  return (
    <ToastViewport>
      {notifications.map((notification) => (
        <AutoDismissToast key={notification.id} notification={notification} />
      ))}
    </ToastViewport>
  );
}
