import type { Agent } from "@pulsedesk/contracts";

/**
 * The signed-in team member. Authentication is out of scope for this project; a fixed
 * demo agent keeps presence and UI honest without pretending to have auth.
 */
export const currentAgent: Agent & { role: string; email: string } = {
  id: "agent_demo",
  name: "Jordan Lee",
  role: "Support lead",
  email: "jordan@acme.example",
};
