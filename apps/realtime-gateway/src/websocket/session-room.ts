import type { Agent } from "@pulsedesk/contracts";

interface Watcher {
  agent: Agent;
  connections: Set<string>;
}

export type PresenceChange = { type: "joined" | "left"; sessionId: string; agent: Agent };

/**
 * Which agents are watching which sessions. Presence is per *agent*, not per socket: an
 * agent with the session open in two tabs joins once and leaves when the last tab does.
 *
 * Note: agent identity comes from the client's hello and is not authenticated in this
 * demo. A production gateway would take it from a verified session token.
 */
export class SessionRooms {
  // sessionId → agentId → watcher
  readonly #rooms = new Map<string, Map<string, Watcher>>();

  watch(connectionId: string, agent: Agent, sessionId: string): PresenceChange | null {
    let room = this.#rooms.get(sessionId);
    if (!room) {
      room = new Map();
      this.#rooms.set(sessionId, room);
    }
    const existing = room.get(agent.id);
    if (existing) {
      existing.connections.add(connectionId);
      return null;
    }
    room.set(agent.id, { agent, connections: new Set([connectionId]) });
    return { type: "joined", sessionId, agent };
  }

  unwatch(connectionId: string, agentId: string, sessionId: string): PresenceChange | null {
    const room = this.#rooms.get(sessionId);
    const watcher = room?.get(agentId);
    if (!room || !watcher || !watcher.connections.delete(connectionId)) return null;
    if (watcher.connections.size > 0) return null;
    room.delete(agentId);
    if (room.size === 0) this.#rooms.delete(sessionId);
    return { type: "left", sessionId, agent: watcher.agent };
  }

  /** Remove a connection from every room (socket closed). */
  leaveAll(connectionId: string, agentId: string): PresenceChange[] {
    const changes: PresenceChange[] = [];
    for (const sessionId of [...this.#rooms.keys()]) {
      const change = this.unwatch(connectionId, agentId, sessionId);
      if (change) changes.push(change);
    }
    return changes;
  }

  viewers(sessionId: string): Agent[] {
    return [...(this.#rooms.get(sessionId)?.values() ?? [])].map((w) => w.agent);
  }
}
