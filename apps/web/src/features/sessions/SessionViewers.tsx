import type { Agent } from "@pulsedesk/contracts";
import { Avatar } from "@pulsedesk/ui";
import { currentAgent } from "@/lib/current-agent";

/** Who else is looking at this session (presence), with the current agent listed as "You". */
export function SessionViewers({ viewers }: { viewers: Agent[] }) {
  if (viewers.length === 0) return null;
  const ordered = [...viewers].sort(
    (a, b) => Number(b.id === currentAgent.id) - Number(a.id === currentAgent.id),
  );
  const names = ordered.map((agent) => (agent.id === currentAgent.id ? "You" : agent.name));
  const label = `Viewing now: ${names.join(", ")}`;

  return (
    <div className="flex items-center gap-2" aria-label={label} role="group">
      <div className="flex -space-x-1.5">
        {ordered.slice(0, 4).map((agent) => (
          <Avatar
            key={agent.id}
            name={agent.name}
            seed={agent.id}
            size="sm"
            className="ring-2 ring-canvas"
          />
        ))}
      </div>
      <span aria-hidden="true" className="text-xs text-fg-muted">
        {names.length === 1 && names[0] === "You"
          ? "Only you are viewing"
          : `${names.join(", ")} viewing`}
      </span>
    </div>
  );
}
