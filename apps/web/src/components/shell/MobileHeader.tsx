import { cx } from "@pulsedesk/ui";
import { NavLink } from "react-router";
import { BrandMark } from "./BrandMark";
import { navItems } from "./nav-items";
import { LiveConnectionIndicator } from "@/features/realtime/LiveConnectionIndicator";
import { UserMenu } from "./UserMenu";

/**
 * Below `lg` the sidebar collapses into a compact header with inline navigation.
 * With only a handful of destinations this beats a hamburger drawer: zero JS,
 * nothing hidden, one tap to navigate.
 */
export function MobileHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur lg:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <NavLink to="/dashboard" aria-label="PulseDesk home" className="rounded-md">
          <BrandMark />
        </NavLink>
        <div className="flex items-center gap-2">
          <LiveConnectionIndicator />
          <UserMenu compact />
        </div>
      </div>
      <nav aria-label="Primary" className="-mb-px flex gap-1 overflow-x-auto px-3">
        {navItems.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cx(
                "border-b-2 px-2.5 pt-1 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                isActive
                  ? "border-accent text-fg"
                  : "border-transparent text-fg-muted hover:text-fg",
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
