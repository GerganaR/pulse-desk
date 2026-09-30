import {
  Avatar,
  DropdownMenu,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@pulsedesk/ui";
import { ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "@/app/theme";
import { currentAgent } from "@/lib/current-agent";

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu
      triggerLabel={`Account menu for ${currentAgent.name}`}
      triggerClassName="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 text-sm text-fg transition-colors hover:bg-surface-hover aria-expanded:bg-surface-hover"
      trigger={
        <>
          <Avatar name={currentAgent.name} seed={currentAgent.id} size="sm" />
          {!compact && <span className="font-medium">{currentAgent.name}</span>}
          <ChevronDown aria-hidden="true" className="size-3.5 text-fg-subtle" />
        </>
      }
    >
      <div className="px-2.5 py-2">
        <p className="text-sm font-medium text-fg">{currentAgent.name}</p>
        <p className="text-xs text-fg-muted">{currentAgent.email}</p>
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuRadioGroup<ThemePreference> label="Theme" value={theme} onValueChange={setTheme}>
        <DropdownMenuRadioItem value="system" icon={<Monitor />}>
          System
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="light" icon={<Sun />}>
          Light
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dark" icon={<Moon />}>
          Dark
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Signed in as {currentAgent.role}</DropdownMenuLabel>
    </DropdownMenu>
  );
}
