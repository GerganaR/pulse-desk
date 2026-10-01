import { Outlet } from "react-router";
import { useConfig } from "@/app/config";
import { DevTools } from "@/features/devtools/DevTools";
import { Toaster } from "@/features/notifications/Toaster";
import { OutageBanner } from "@/features/realtime/OutageBanner";
import { MobileHeader } from "./MobileHeader";
import { RouteBoundary } from "./RouteBoundary";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell() {
  const { devTools } = useConfig();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm font-medium shadow-overlay focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-col">
        <MobileHeader />
        <TopBar />
        <main
          id="main"
          tabIndex={-1}
          className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:pt-6 lg:pb-10"
        >
          <OutageBanner />
          <RouteBoundary>
            <Outlet />
          </RouteBoundary>
        </main>
      </div>
      <Toaster />
      {/* Compile-time constant first, so production builds drop the branch entirely. */}
      {__DEVTOOLS__ && devTools && <DevTools />}
    </div>
  );
}
