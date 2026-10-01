import type { AIAction, AIError, UnverifiedClaim } from "@pulsedesk/contracts";
import {
  createEntityAdapter,
  createSelector,
  createSlice,
  type EntityState,
  type PayloadAction,
} from "@reduxjs/toolkit";

export type AIRequestStatus = "streaming" | "done" | "failed" | "cancelled";

/** One attempt at answering one question about one session. */
export interface AIRequest {
  id: string;
  sessionId: string;
  action: AIAction;
  /** The agent's question for `ask`; empty for quick actions. */
  prompt: string;
  status: AIRequestStatus;
  /** Answer so far. Kept when the request fails or is cancelled. */
  text: string;
  error: AIError | null;
  startedAt: number;
  firstTokenAt: number | null;
  finishedAt: number | null;
  /** 1 for the first try; a retry replaces its predecessor with attempt + 1. */
  attempt: number;
  model: string | null;
  finishReason: "stop" | "length" | null;
  /** Claims in the finished answer that ai-service couldn't verify against the session. */
  unverified: UnverifiedClaim[];
}

export interface AIState {
  requests: EntityState<AIRequest, string>;
  /** Request ids per session, in conversation order. */
  conversations: Record<string, string[]>;
  /** Answers completed in this tab. */
  completedCount: number;
}

/** Older turns are dropped past this; the conversation is a working aid, not an archive. */
export const MAX_CONVERSATION_TURNS = 20;

const requestsAdapter = createEntityAdapter<AIRequest>();

export const initialAIState: AIState = {
  requests: requestsAdapter.getInitialState(),
  conversations: {},
  completedCount: 0,
};

export interface AIRequestStartedPayload {
  id: string;
  sessionId: string;
  action: AIAction;
  prompt: string;
  startedAt: number;
  /** Id of the failed or cancelled attempt this retries; it's replaced in place. */
  retryOf?: string;
}

/** Updates only apply while a request is streaming, so late chunks after cancel are ignored. */
function streaming(state: AIState, id: string): AIRequest | undefined {
  const request = state.requests.entities[id];
  return request?.status === "streaming" ? request : undefined;
}

export const aiSlice = createSlice({
  name: "ai",
  initialState: initialAIState,
  reducers: {
    aiRequestStarted(state, action: PayloadAction<AIRequestStartedPayload>) {
      const { id, sessionId, retryOf, ...rest } = action.payload;
      if (state.requests.entities[id]) return;
      const conversation = (state.conversations[sessionId] ??= []);
      const previous = retryOf ? state.requests.entities[retryOf] : undefined;
      if (previous?.status === "streaming") return; // nothing to retry yet

      requestsAdapter.addOne(state.requests, {
        id,
        sessionId,
        ...rest,
        status: "streaming",
        text: "",
        error: null,
        firstTokenAt: null,
        finishedAt: null,
        attempt: previous ? previous.attempt + 1 : 1,
        model: null,
        finishReason: null,
        unverified: [],
      });
      const index = previous ? conversation.indexOf(previous.id) : -1;
      if (previous && index !== -1) {
        conversation[index] = id;
        requestsAdapter.removeOne(state.requests, previous.id);
        return;
      }
      conversation.push(id);
      // Trim the oldest finished turns; never one that is still streaming.
      while (conversation.length > MAX_CONVERSATION_TURNS) {
        const oldest = conversation.findIndex(
          (rid) => state.requests.entities[rid]?.status !== "streaming",
        );
        if (oldest === -1) break;
        const [removed] = conversation.splice(oldest, 1);
        if (removed) requestsAdapter.removeOne(state.requests, removed);
      }
    },
    /** Text appended since the last update (batched by the caller, e.g. once per frame). */
    aiTextReceived(state, action: PayloadAction<{ id: string; text: string; at: number }>) {
      const request = streaming(state, action.payload.id);
      if (!request || !action.payload.text) return;
      request.text += action.payload.text;
      request.firstTokenAt ??= action.payload.at;
    },
    aiRequestCompleted(
      state,
      action: PayloadAction<{
        id: string;
        at: number;
        model: string;
        finishReason: "stop" | "length";
        unverified?: UnverifiedClaim[];
      }>,
    ) {
      const request = streaming(state, action.payload.id);
      if (!request) return;
      request.status = "done";
      request.finishedAt = action.payload.at;
      request.model = action.payload.model;
      request.finishReason = action.payload.finishReason;
      request.unverified = action.payload.unverified ?? [];
      state.completedCount++;
    },
    aiRequestFailed(state, action: PayloadAction<{ id: string; at: number; error: AIError }>) {
      const request = streaming(state, action.payload.id);
      if (!request) return;
      request.status = "failed";
      request.finishedAt = action.payload.at;
      request.error = action.payload.error;
    },
    aiRequestCancelled(state, action: PayloadAction<{ id: string; at: number }>) {
      const request = streaming(state, action.payload.id);
      if (!request) return;
      request.status = "cancelled";
      request.finishedAt = action.payload.at;
    },
  },
});

export const {
  aiRequestStarted,
  aiTextReceived,
  aiRequestCompleted,
  aiRequestFailed,
  aiRequestCancelled,
} = aiSlice.actions;

type WithAI = { ai: AIState };
const EMPTY: AIRequest[] = [];

export const selectAIRequest = (state: WithAI, id: string): AIRequest | undefined =>
  state.ai.requests.entities[id];

/** The session's conversation, oldest first. Stable while nothing in it changes. */
export const selectConversation = createSelector(
  [
    (state: WithAI, sessionId: string) => state.ai.conversations[sessionId],
    (state: WithAI) => state.ai.requests.entities,
  ],
  (ids, requests) => (ids ? ids.flatMap((id) => (requests[id] ? [requests[id]] : [])) : EMPTY),
);

export const selectAIAnswersGenerated = (state: WithAI) => state.ai.completedCount;
