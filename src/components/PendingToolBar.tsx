import { Component, Show, createSignal, createMemo } from "solid-js";
import { sendTmuxKeys, captureTmuxPane } from "../lib/api";
import type { PendingToolCall } from "../lib/sessionState";
import { useSharedClock } from "../lib/clock";
import { parsePromptOptions, keyForIntent } from "../lib/promptDetection";
import { decisionFor, setToolDecision, decisionLabel } from "../lib/toolDecisions";

interface Props {
  pending: PendingToolCall[];
  pane: string | null;
}

const GRACE_MS = 2000;

const PendingToolBar: Component<Props> = (props) => {
  return (
    <Show when={props.pending.length > 0}>
      <PendingToolBarActive pane={props.pane} pending={props.pending} />
    </Show>
  );
};

interface ActiveProps {
  pane: string | null;
  pending: PendingToolCall[];
}

const PendingToolBarActive: Component<ActiveProps> = (props) => {
  const [busy, setBusy] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<string | null>(null);
  const now = useSharedClock();

  const first = createMemo(() => props.pending[0]!);
  const actionable = createMemo(() => {
    const f = first();
    if (!props.pane) return false;
    if (f.ts <= 0) return true;
    return now() - f.ts >= GRACE_MS;
  });

  const send = async (intent: "allow" | "always" | "deny" | "esc") => {
    const pane = props.pane;
    if (!pane || busy()) return;
    setBusy(intent);
    setStatus(null);
    try {
      let key: string;
      if (intent === "esc") {
        key = "Escape";
      } else {
        // Capture CC's actual prompt to map intent → correct key. Option order
        // varies by CC version (Bash often shows: 1=Yes, 2=Deny, 3=Always).
        try {
          const text = await captureTmuxPane(pane);
          const parsed = parsePromptOptions(text);
          key = keyForIntent(intent, parsed);
        } catch {
          key = keyForIntent(intent, { allow: null, always: null, deny: null, raw: [], detected: false });
        }
      }
      await sendTmuxKeys(pane, [key]);
      if (intent !== "esc") {
        const target = first();
        if (target) setToolDecision(target.id, intent);
      }
      setStatus(intent === "esc" ? "esc sent" : `${intent} → ${key}`);
      setTimeout(() => setStatus(null), 1500);
    } catch (e) {
      setStatus(`failed: ${String(e).slice(0, 80)}`);
    } finally {
      setBusy(null);
    }
  };

  const decision = () => {
    const f = first();
    return f ? decisionFor(f.id) : undefined;
  };
  const decided = () => !!decision();

  return (
    <div
      class="dc-pending-bar"
      style={{
        flex: "0 0 auto",
        display: "flex",
        "align-items": "center",
        gap: "10px",
        padding: "8px 14px",
        "border-top": "1px solid var(--rule, var(--border-soft))",
        "border-bottom": "1px solid var(--rule, var(--border-soft))",
        "border-left": (() => {
          const d = decision();
          if (!d) return "3px solid var(--warn, var(--m-warn))";
          return d.kind === "deny"
            ? "3px solid var(--warn, var(--m-warn))"
            : "3px solid var(--ok, var(--m-ok))";
        })(),
        background: (() => {
          const d = decision();
          if (!d) return "var(--warn-bg, rgba(244, 162, 97, 0.08))";
          return d.kind === "deny"
            ? "var(--warn-bg, rgba(244, 162, 97, 0.08))"
            : "var(--ok-bg, rgba(46, 106, 54, 0.1))";
        })(),
        "font-size": "12px",
      }}
    >
      <Show
        when={decision()}
        fallback={
          <span
            style={{
              "font-weight": 600,
              color: "var(--warn, var(--m-warn))",
              "white-space": "nowrap",
            }}
          >
            Pending tool
          </span>
        }
      >
        <span
          style={{
            "font-weight": 600,
            color: decision()!.kind === "deny" ? "var(--warn, var(--m-warn))" : "var(--ok, var(--m-ok))",
            "white-space": "nowrap",
          }}
        >
          {decisionLabel(decision()!.kind)}
        </span>
      </Show>
      <span
        style={{
          color: "var(--ink, var(--m-text))",
          "font-family": "var(--font-mono, ui-monospace, monospace)",
          "white-space": "nowrap",
          overflow: "hidden",
          "text-overflow": "ellipsis",
        }}
      >
        {first().name}
      </span>
      <Show when={props.pending.length > 1}>
        <span class="ink-faint" style={{ "font-size": "11px" }}>
          +{props.pending.length - 1} more
        </span>
      </Show>
      <Show when={!decided() && !actionable() && props.pane}>
        <span class="ink-faint" style={{ "font-size": "11px", "font-style": "italic" }}>
          waiting…
        </span>
      </Show>
      <Show when={decided()}>
        <span class="ink-faint" style={{ "font-size": "11px", "font-style": "italic" }}>
          waiting for tool to finish…
        </span>
      </Show>
      <span style={{ "margin-left": "auto", display: "flex", gap: "6px" }}>
        <button
          type="button"
          class="dc-pending-btn"
          onClick={() => send("allow")}
          disabled={!actionable() || !!busy() || decided()}
          title="Allow once (auto-detects CC's prompt option)"
        >
          Allow
        </button>
        <button
          type="button"
          class="dc-pending-btn"
          onClick={() => send("always")}
          disabled={!actionable() || !!busy() || decided()}
          title="Allow and don't ask again (auto-detects CC's prompt option)"
        >
          Always
        </button>
        <button
          type="button"
          class="dc-pending-btn warn"
          onClick={() => send("deny")}
          disabled={!actionable() || !!busy() || decided()}
          title="Deny and tell Claude (auto-detects CC's prompt option)"
        >
          Deny
        </button>
        <button
          type="button"
          class="dc-pending-btn ghost"
          onClick={() => send("esc")}
          disabled={!!busy() || !props.pane}
          title="Send Escape (close CC dialog)"
        >
          esc
        </button>
      </span>
      <Show when={status()}>
        <span
          style={{
            "font-size": "11px",
            color: status() === "sent" ? "var(--ok, var(--m-ok))" : "var(--warn, var(--m-warn))",
          }}
        >
          {status()}
        </span>
      </Show>
    </div>
  );
};

export default PendingToolBar;
