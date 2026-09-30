import { Badge } from "@pulsedesk/ui";
import { UserMenu } from "./UserMenu";

/** Desktop-only bar above page content: workspace context and account menu. */
export function TopBar() {
  return (
    <header className="sticky top-0 z-20 hidden h-14 items-center justify-between border-b border-line bg-canvas/85 px-8 backdrop-blur lg:flex">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-fg">acme.example</span>
        <Badge>Production</Badge>
      </div>
      <UserMenu />
    </header>
  );
}
