import { Button, Card, ErrorState, Skeleton } from "@pulsedesk/ui";
import { RotateCw } from "lucide-react";
import { Component, Suspense, type ReactNode } from "react";
import { useLocation } from "react-router";

interface BoundaryProps {
  /** Changes on navigation, so going somewhere else clears the error. */
  resetKey: string;
  children: ReactNode;
}

interface BoundaryState {
  failed: boolean;
  resetKey: string;
}

/**
 * Pages are lazy chunks, so a page can fail to load (offline, or a deploy replaced the
 * file a long-lived tab knows about). Without a boundary React would unmount the whole
 * document; with one, the shell stays and the page area explains what to do.
 */
class RouteErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: BoundaryProps,
    state: BoundaryState,
  ): BoundaryState | null {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }

  override componentDidCatch(error: unknown) {
    console.error("[route] failed to render", error);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Card>
        <ErrorState
          title="This page couldn't be loaded"
          description="The app may have been updated, or the connection dropped. Reloading usually fixes it."
          action={
            <Button
              onClick={() => window.location.reload()}
              leadingIcon={<RotateCw aria-hidden="true" className="size-3.5" />}
            >
              Reload
            </Button>
          }
        />
      </Card>
    );
  }
}

/** Seen only if a page chunk is still loading when there is nothing else to show. */
function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading page">
      <Skeleton className="mb-6 h-8 w-48" />
      <Card className="space-y-3 p-5">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/5" />
      </Card>
    </div>
  );
}

export function RouteBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <RouteErrorBoundary resetKey={pathname}>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}
