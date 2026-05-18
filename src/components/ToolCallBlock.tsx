import { Component, createSignal, createMemo, Show } from "solid-js";
import type { ContentBlock } from "../lib/types";
import { sendTmuxKeys } from "../lib/api";
import { useSharedClock } from "../lib/clock";
import { decisionFor, setToolDecision, decisionLabel } from "../lib/toolDecisions";

interface Props {
  block: Extract<ContentBlock, { type: "tool_call" }>;
  result?: Extract<ContentBlock, { type: "tool_result" }>;
  pending?: boolean;
  firstPending?: boolean;
  pane?: string | null;
  ts?: number;
  // Parent-owned expansion state — survives virtualization unmount/remount.
  isExpanded?: (toolId: string) => boolean;
  onToggleExpanded?: (toolId: string) => void;
}

const GRACE_MS = 2000;

const ToolCallBlock: Component<Props> = (props) => {
  const expanded = () =>
    props.isExpanded ? props.isExpanded(props.block.tool_id) : false;
  const toggleExpanded = () => {
    if (props.onToggleExpanded) props.onToggleExpanded(props.block.tool_id);
  };
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<string | null>(null);
  const now = useSharedClock();

  const parsedInput = createMemo<Record<string, unknown> | null>(() => {
    try {
      return JSON.parse(props.block.input);
    } catch {
      return null;
    }
  });

  const grace = () => {
    const ts = props.ts ?? 0;
    if (!ts) return true;
    return now() - ts >= GRACE_MS;
  };
  const canAct = () => !!props.pending && !!props.firstPending && !!props.pane && grace();

  const fire = async (intent: "allow" | "always" | "deny" | "esc") => {
    if (intent !== "esc" && !canAct()) return;
    if (busy() || !props.pane) return;
    setBusy(true);
    setStatus(null);
    try {
      // Fixed mapping: CC permission prompt is always 1=Allow, 2=Always, 3=Deny.
      const KEY: Record<string, string> = { allow: "1", always: "2", deny: "3", esc: "Escape" };
      const key = KEY[intent] ?? "Escape";
      await sendTmuxKeys(props.pane!, [key]);
      if (intent !== "esc") {
        setToolDecision(props.block.tool_id, intent);
      }
      setStatus(intent === "esc" ? "esc sent" : `${intent} → ${key}`);
      setTimeout(() => setStatus(null), 1500);
    } catch (e) {
      setStatus(`failed: ${String(e).slice(0, 60)}`);
    } finally {
      setBusy(false);
    }
  };

  const decision = () => decisionFor(props.block.tool_id);
  const decided = () => !!decision();

  const inputPreview = () => {
    const parsed = parsedInput();
    if (!parsed) return props.block.input.slice(0, 80);
    const keys = Object.keys(parsed);
    if (keys.length === 0) return "";
    return keys
      .map((k) => {
        const v = (parsed as Record<string, unknown>)[k];
        const vs = typeof v === "string" ? v : JSON.stringify(v);
        return `${k}: ${vs.length > 50 ? vs.slice(0, 50) + "..." : vs}`;
      })
      .join(", ");
  };

  return (
    <div style={{ margin: "2px 0" }}>
      <div
        onClick={() => toggleExpanded()}
        style={{
          display: "grid",
          "grid-template-columns": "auto auto 1fr",
          gap: "6px",
          "align-items": "center",
          "font-size": "11.5px",
          padding: "2px 6px",
          background: props.pending ? "var(--warn-bg, rgba(244, 162, 97, 0.08))" : "var(--info-bg)",
          border: "1px solid var(--rule-soft)",
          "border-left": props.pending ? "2px solid var(--warn, var(--m-warn))" : "2px solid var(--info)",
          cursor: "pointer",
        }}
      >
        <span style={{ color: "var(--info)", "font-weight": 600 }}>
          {expanded() ? "▾" : "→"}
        </span>
        <span style={{ color: "var(--info)", "font-weight": 600 }}>{props.block.tool_name}</span>
        <Show when={!expanded()}>
          <span class="ink-mid" style={{
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            "font-size": "11px",
          }}>
            {inputPreview()}
          </span>
        </Show>
      </div>

      <Show when={expanded()}>
        <div style={{
          padding: "4px 6px",
          "border-top": "1px solid var(--rule-soft)",
          "font-size": "11px",
          background: "var(--paper-3)",
          border: "1px solid var(--rule-soft)",
          "border-left": "2px solid var(--info)",
        }}>
          <div class="ink-faint" style={{ "margin-bottom": "2px" }}>Input:</div>
          <pre style={{
            color: "var(--info)",
            "white-space": "pre-wrap",
            "word-break": "break-all",
            "max-height": "200px",
            overflow: "auto",
            margin: 0,
          }}>
            {(() => {
              const parsed = parsedInput();
              return parsed ? JSON.stringify(parsed, null, 2) : props.block.input;
            })()}
          </pre>
          <Show when={props.result}>
            <div class="ink-faint" style={{ "margin-top": "6px", "margin-bottom": "2px" }}>
              {props.result!.is_error ? "Error:" : "Output:"}
            </div>
            <pre style={{
              color: props.result!.is_error ? "var(--warn)" : "var(--ink-2)",
              "white-space": "pre-wrap",
              "word-break": "break-all",
              "max-height": "200px",
              overflow: "auto",
              margin: 0,
            }}>
              {props.result!.output}
            </pre>
          </Show>
        </div>
      </Show>

      <Show when={props.pending}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "6px",
            margin: "4px 0 6px 14px",
            padding: "5px 8px",
            "font-size": "11.5px",
            "border-left": (() => {
              const d = decision();
              if (!d) return "2px solid var(--warn, var(--m-warn))";
              return d.kind === "deny"
                ? "2px solid var(--warn, var(--m-warn))"
                : "2px solid var(--ok, var(--m-ok))";
            })(),
            background: (() => {
              const d = decision();
              if (!d) return "var(--warn-bg, rgba(244, 162, 97, 0.06))";
              return d.kind === "deny"
                ? "var(--warn-bg, rgba(244, 162, 97, 0.06))"
                : "var(--ok-bg, rgba(46, 106, 54, 0.08))";
            })(),
          }}
        >
          <Show
            when={decision()}
            fallback={
              <span style={{ color: "var(--warn, var(--m-warn))", "font-weight": 600 }}>
                awaiting permission
              </span>
            }
          >
            <span
              style={{
                color: decision()!.kind === "deny" ? "var(--warn, var(--m-warn))" : "var(--ok, var(--m-ok))",
                "font-weight": 600,
              }}
            >
              {decisionLabel(decision()!.kind)}
            </span>
          </Show>
          <Show when={!decision() && !props.firstPending}>
            <span class="ink-faint" style={{ "font-size": "10.5px", "font-style": "italic" }}>
              approve previous first
            </span>
          </Show>
          <Show when={!decision() && props.firstPending && !grace() && props.pane}>
            <span class="ink-faint" style={{ "font-size": "10.5px", "font-style": "italic" }}>
              waiting…
            </span>
          </Show>
          <Show when={!decision() && props.firstPending && !props.pane}>
            <span class="ink-faint" style={{ "font-size": "10.5px", "font-style": "italic" }}>
              no tmux pane
            </span>
          </Show>
          <Show when={decision()}>
            <span class="ink-faint" style={{ "font-size": "10.5px", "font-style": "italic" }}>
              waiting for tool to finish…
            </span>
          </Show>
          <span style={{ "margin-left": "auto", display: "flex", gap: "4px" }}>
            <button
              type="button"
              class="dc-pending-btn"
              onClick={(e) => { e.stopPropagation(); fire("allow"); }}
              disabled={!canAct() || busy() || decided()}
              title="Allow once (auto-detects CC's prompt option)"
            >
              Allow
            </button>
            <button
              type="button"
              class="dc-pending-btn"
              onClick={(e) => { e.stopPropagation(); fire("always"); }}
              disabled={!canAct() || busy() || decided()}
              title="Allow and don't ask again (auto-detects CC's prompt option)"
            >
              Always
            </button>
            <button
              type="button"
              class="dc-pending-btn warn"
              onClick={(e) => { e.stopPropagation(); fire("deny"); }}
              disabled={!canAct() || busy() || decided()}
              title="Deny and tell Claude (auto-detects CC's prompt option)"
            >
              Deny
            </button>
            <button
              type="button"
              class="dc-pending-btn ghost"
              onClick={(e) => { e.stopPropagation(); fire("esc"); }}
              disabled={!props.firstPending || !props.pane || busy()}
            >
              esc
            </button>
          </span>
          <Show when={status()}>
            <span style={{
              "font-size": "10.5px",
              color: status()?.startsWith("failed") ? "var(--warn)" : "var(--ok)",
              "margin-left": "4px",
            }}>{status()}</span>
          </Show>
        </div>
      </Show>

      <Show when={props.result && !expanded()}>
        <div style={{
          display: "grid",
          "grid-template-columns": "auto auto 1fr",
          gap: "6px",
          "align-items": "center",
          "font-size": "11px",
          margin: "0 0 6px 14px",
          padding: "1px 6px",
          color: props.result!.is_error ? "var(--warn)" : "var(--ink-2)",
        }}>
          <span style={{ color: props.result!.is_error ? "var(--warn)" : "var(--ok)" }}>←</span>
          <span class="ink-faint" style={{ "font-size": "10.5px" }}>{props.block.tool_name}</span>
          <span style={{
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            "font-size": "11px",
            color: props.result!.is_error ? "var(--warn)" : "var(--ink-2)",
          }}>
            {props.result!.output.replace(/\s+/g, " ").slice(0, 200)}
          </span>
        </div>
      </Show>
    </div>
  );
};

export default ToolCallBlock;
