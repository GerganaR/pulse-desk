import type { AIFault } from "@pulsedesk/contracts";
import type { RealtimeClient, RealtimeClientStats } from "@pulsedesk/realtime-client";
import type { FaultInjector } from "@pulsedesk/realtime-client/fault-injection";
import { selectConnection } from "@pulsedesk/state";
import { Badge, Button, Dialog, Input, Tooltip, cx } from "@pulsedesk/ui";
import { Copy, Shuffle, Trash2, Unplug, Plug, Wrench } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAppSelector } from "@/app/hooks";
import { useAIFaults } from "@/features/copilot/AIFaultsProvider";
import { toIndicatorStatus } from "@/features/realtime/LiveConnectionIndicator";
import { useFaultInjector, useRealtimeClient } from "@/features/realtime/RealtimeProvider";
import { useNow } from "@/lib/clock";
import { formatLatency, formatRelative } from "@/lib/format";

/**
 * Developer reliability panel: live connection diagnostics plus fault injection into the
 * real connection, so every recovery path can be demonstrated on demand.
 *
 * Development and devtools builds only. This module is reached solely through a lazy
 * import behind the `__DEVTOOLS__` build constant, and carries the marker below so the
 * production bundle check can prove it isn't there.
 */
const MARKER = "pulsedesk-devtools";

const LATENCY_OPTIONS = [0, 250, 1_500, 3_000] as const;

const AI_FAULT_OPTIONS: readonly { value: AIFault | null; label: string }[] = [
  { value: null, label: "Off" },
  { value: "timeout", label: "Timeout" },
  { value: "http_500", label: "Error 500" },
  { value: "slow", label: "Slow" },
];

function useClientStats(client: RealtimeClient) {
  const [stats, setStats] = useState<RealtimeClientStats>(() => client.getStats());
  const [cursor, setCursor] = useState(() => client.getState().cursor);
  useEffect(() => {
    const timer = setInterval(() => {
      setStats(client.getStats());
      setCursor(client.getState().cursor);
    }, 500);
    return () => clearInterval(timer);
  }, [client]);
  return { stats, cursor };
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "warning" }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-fg-subtle">{label}</dt>
      <dd
        className={cx(
          "truncate font-mono text-xs tabular-nums",
          tone === "warning" ? "text-warning" : "text-fg",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function ConnectionStats({ client }: { client: RealtimeClient }) {
  const connection = useAppSelector(selectConnection);
  const { stats, cursor } = useClientStats(client);
  const now = useNow();
  return (
    <section aria-labelledby="devtools-connection" className="border-b border-line px-4 py-3">
      <h3 id="devtools-connection" className="mb-2 text-xs font-semibold text-fg-muted">
        Connection
      </h3>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
        <Stat label="Status" value={toIndicatorStatus(connection)} />
        <Stat
          label="Round trip"
          value={connection.rttMs !== null ? formatLatency(connection.rttMs) : "–"}
          tone={connection.degraded ? "warning" : undefined}
        />
        <Stat label="Cursor" value={cursor ? `#${cursor.sequence}` : "–"} />
        <Stat label="Reconnect attempts" value={stats.reconnectCount} />
        <Stat label="Gaps / resyncs" value={`${stats.gapsDetected} / ${stats.resyncs}`} />
        <Stat
          label="Reorder buffer"
          value={stats.pendingEvents}
          tone={stats.pendingEvents > 0 ? "warning" : undefined}
        />
        <Stat label="Duplicates dropped" value={stats.duplicatesDropped} />
        <Stat label="Stale dropped" value={stats.staleDropped} />
        <Stat
          label="Last event"
          value={stats.lastEventAt !== null ? formatRelative(now - stats.lastEventAt) : "–"}
        />
      </dl>
    </section>
  );
}

function ControlRow({
  title,
  description,
  armed,
  children,
}: {
  title: string;
  description: string;
  armed?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm text-fg">
          {title}
          {armed}
        </p>
        <p className="text-xs text-fg-muted">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function FaultButton({
  hint,
  children,
  ...props
}: { hint: string; children: ReactNode } & Parameters<typeof Button>[0]) {
  return (
    <Tooltip content={hint} side="top" align="end">
      {(trigger) => (
        <Button size="sm" {...trigger} {...props}>
          {children}
        </Button>
      )}
    </Tooltip>
  );
}

function FaultControls({ faults, client }: { faults: FaultInjector; client: RealtimeClient }) {
  const state = useSyncExternalStore(faults.subscribe, faults.getState, faults.getState);
  const [dropCount, setDropCount] = useState(3);
  const dropId = useId();

  return (
    <section aria-labelledby="devtools-faults" className="border-b border-line px-4 py-2">
      <h3 id="devtools-faults" className="sr-only">
        Faults
      </h3>
      <ControlRow
        title="Network"
        description={
          state.disconnected
            ? "Cut. Reconnect attempts fail until restored."
            : "Drop the socket and block reconnects."
        }
      >
        {state.disconnected ? (
          <FaultButton
            variant="primary"
            hint="Restores the network and retries at once. Missed events replay in order."
            leadingIcon={<Plug aria-hidden="true" className="size-3.5" />}
            onClick={() => {
              faults.restore();
              client.reconnectNow();
            }}
          >
            Reconnect
          </FaultButton>
        ) : (
          <FaultButton
            variant="danger"
            hint="Abnormal close (1006), like a lost network. Expect Reconnecting with backoff."
            leadingIcon={<Unplug aria-hidden="true" className="size-3.5" />}
            onClick={() => faults.disconnect()}
          >
            Disconnect
          </FaultButton>
        )}
      </ControlRow>

      <Segmented
        legend="Latency"
        description={`Delays every inbound frame. Above ${formatLatency(1_000)} the connection shows Degraded.`}
        options={LATENCY_OPTIONS.map((ms) => ({
          value: ms,
          label: ms === 0 ? "Off" : formatLatency(ms),
        }))}
        value={state.latencyMs}
        onChange={(ms) => {
          faults.setLatency(ms);
          client.checkConnection(); // measure the new RTT now, not at the next beat
        }}
      />

      <ControlRow
        title="Drop events"
        description="Lose events in transit: gap → wait → resync."
        armed={state.dropRemaining > 0 && <Badge tone="warning">{state.dropRemaining} armed</Badge>}
      >
        <label htmlFor={dropId} className="sr-only">
          Events to drop
        </label>
        <Input
          id={dropId}
          type="number"
          min={1}
          max={50}
          value={dropCount}
          onChange={(event) =>
            setDropCount(Math.min(50, Math.max(1, event.target.valueAsNumber || 1)))
          }
          className="h-7 w-14 px-2 text-xs"
        />
        <FaultButton
          hint="The client notices the hole when a later event (or a heartbeat) arrives, waits 2 s for it, then asks the gateway to replay."
          leadingIcon={<Trash2 aria-hidden="true" className="size-3.5" />}
          onClick={() => faults.dropEvents(dropCount)}
        >
          Drop
        </FaultButton>
      </ControlRow>

      <ControlRow
        title="Duplicate next event"
        description="Deliver it twice: deduplicated."
        armed={state.duplicateArmed && <Badge tone="warning">armed</Badge>}
      >
        <FaultButton
          hint="The copy is dropped by sequence (and eventId). The timeline never shows it twice."
          leadingIcon={<Copy aria-hidden="true" className="size-3.5" />}
          onClick={() => faults.duplicateNextEvent()}
        >
          Duplicate
        </FaultButton>
      </ControlRow>

      <ControlRow
        title="Reorder next batch"
        description="Deliver it after the one behind it: reorder buffer."
        armed={state.reorderArmed && <Badge tone="warning">armed</Badge>}
      >
        <FaultButton
          hint="The later batch is held in the reorder buffer until the earlier one arrives, then both apply in order. No resync needed."
          leadingIcon={<Shuffle aria-hidden="true" className="size-3.5" />}
          onClick={() => faults.reorderNextBatch()}
        >
          Reorder
        </FaultButton>
      </ControlRow>
    </section>
  );
}

/** Segmented radio group styled like the latency control. */
function Segmented<T>({
  legend,
  description,
  options,
  value,
  onChange,
}: {
  legend: string;
  description: ReactNode;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="pt-3 pb-2">
      <legend className="text-sm text-fg">{legend}</legend>
      <p className="text-xs text-fg-muted">{description}</p>
      <div className="mt-2 inline-flex rounded-lg border border-line bg-surface-muted p-0.5">
        {options.map((option) => (
          <label
            key={option.label}
            className={cx(
              "cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium has-focus-visible:outline-2 has-focus-visible:outline-focus",
              value === option.value
                ? "bg-surface text-fg shadow-card"
                : "text-fg-muted hover:text-fg",
            )}
          >
            <input
              type="radio"
              name={name}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * AI faults are server behaviour (ai-service's timeouts, the proxy's error path), so the
 * selection travels with each copilot request as a header instead of wrapping a transport.
 */
function AIFaultControls() {
  const faults = useAIFaults();
  const noop = () => () => {};
  const selected = useSyncExternalStore(
    faults?.subscribe ?? noop,
    () => faults?.get() ?? null,
    () => null,
  );
  if (!faults) return null;
  return (
    <section aria-labelledby="devtools-ai" className="border-b border-line px-4 pb-2">
      <h3 id="devtools-ai" className="sr-only">
        AI copilot faults
      </h3>
      <Segmented
        legend="AI copilot"
        description="Applies to new copilot requests. The live connection is unaffected."
        options={AI_FAULT_OPTIONS}
        value={selected}
        onChange={(fault) => faults.set(fault)}
      />
    </section>
  );
}

function FaultLog({ faults }: { faults: FaultInjector }) {
  const log = useSyncExternalStore(faults.subscribe, faults.getLog, faults.getLog);
  const now = useNow();
  return (
    <section aria-labelledby="devtools-log" className="px-4 py-3">
      <h3 id="devtools-log" className="mb-2 text-xs font-semibold text-fg-muted">
        Injected faults
      </h3>
      {log.length === 0 ? (
        <p className="text-xs text-fg-subtle">Nothing injected yet.</p>
      ) : (
        <ol role="log" className="space-y-1">
          {log.slice(0, 8).map((entry) => (
            <li key={entry.id} className="flex gap-3 font-mono text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">{formatRelative(now - entry.at)}</span>
              <span className="text-fg">{entry.message}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function ReliabilityPanel() {
  const client = useRealtimeClient();
  const faults = useFaultInjector();
  const [open, setOpen] = useState(false);

  return (
    <div data-devtools={MARKER}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-4 left-4 z-40 max-lg:top-[4.25rem] max-lg:right-4 max-lg:bottom-auto max-lg:left-auto inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-medium text-fg-muted shadow-overlay hover:text-fg"
      >
        <Wrench aria-hidden="true" className="size-3.5" />
        Reliability
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        modal={false}
        placement="bottom-start"
        title="Reliability panel"
        description="Development only. Faults apply to this tab's live connection."
      >
        <ConnectionStats client={client} />
        {faults ? (
          <>
            <FaultControls faults={faults} client={client} />
            <AIFaultControls />
            <FaultLog faults={faults} />
          </>
        ) : (
          <p className="px-4 py-3 text-xs text-fg-muted">Fault injection isn't available.</p>
        )}
      </Dialog>
    </div>
  );
}
