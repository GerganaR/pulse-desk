import { cx } from "@pulsedesk/ui";
import { NavLink } from "react-router";
import { BrandMark } from "./BrandMark";
import { navItems } from "./nav-items";

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
      <div className="flex h-14 items-center px-5">
        <NavLink to="/dashboard" aria-label="PulseDesk home" className="rounded-md">
          <BrandMark />
        </NavLink>
      </div>

      <nav aria-label="Primary" className="flex-1 px-3 py-4">
        <p className="px-2 pb-2 text-[11px] font-medium tracking-wider text-fg-subtle uppercase">
          Workspace
        </p>
        <ul className="space-y-0.5">
          {navItems.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cx(
                    "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-accent-soft text-accent"
                      : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                  )
                }
              >
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
