import { createSignal } from "solid-js";

export type ToolDecisionKind = "allow" | "always" | "deny";

export interface ToolDecision {
  kind: ToolDecisionKind;
  at: number;
}

/**
 * Optimistic record of the user's choice on a pending tool call. Stored by
 * tool_use_id (unique across CC). The UI uses this to flip "awaiting
 * permission" to "allowed" / "allowed always" / "denied" instantly, before
 * the JSONL tool_result lands. Entries linger after resolution — that's
 * harmless because the pending block stops rendering once a result arrives.
 */
const [decisions, setDecisions] = createSignal<Map<string, ToolDecision>>(new Map());

export function toolDecisions(): Map<string, ToolDecision> {
  return decisions();
}

export function decisionFor(toolId: string): ToolDecision | undefined {
  return decisions().get(toolId);
}

export function setToolDecision(toolId: string, kind: ToolDecisionKind): void {
  setDecisions((prev) => {
    const next = new Map(prev);
    next.set(toolId, { kind, at: Date.now() });
    return next;
  });
}

export function clearToolDecision(toolId: string): void {
  setDecisions((prev) => {
    if (!prev.has(toolId)) return prev;
    const next = new Map(prev);
    next.delete(toolId);
    return next;
  });
}

export function decisionLabel(kind: ToolDecisionKind): string {
  if (kind === "allow") return "allowed";
  if (kind === "always") return "allowed always";
  return "denied";
}
