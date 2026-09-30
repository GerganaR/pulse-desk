import { Button, ErrorState } from "@pulsedesk/ui";
import { RotateCw } from "lucide-react";

export function SessionsLoadError({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <ErrorState
      title="Couldn't load sessions"
      description={error ?? "Something went wrong while loading session data."}
      action={
        <Button onClick={onRetry} leadingIcon={<RotateCw aria-hidden="true" className="size-4" />}>
          Try again
        </Button>
      }
    />
  );
}
