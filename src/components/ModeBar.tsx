import { Component, For, Show, createSignal, createEffect, onCleanup } from "solid-js";
import { sendTmuxKeys, captureTmuxPane } from "../lib/api";

interface Props {
  pane: string | null;
  sessionId: string;
}

type ModeId = "default" | "acceptEdits" | "plan" | "auto" | "bypass";

interface ModeDef {
  id: ModeId;
  label: string;
  hint: string;
}

const MODES: ModeDef[] = [
  { id: "default", label: "None", hint: "Default · ask before each tool" },
  { id: "acceptEdits", label: "Accept Edits", hint: "Auto-approve edits & basic filesystem commands" },
  { id: "plan", label: "Plan", hint: "Research and propose, no edits" },
  { id: "auto", label: "Auto", hint: "Auto-run everything (requires Max/Team/Enterprise/API + opt-in)" },
];

const POLL_MS = 2500;
const STEP_DELAY_MS = 220;
const MAX_STEPS = 6;

function detectMode(text: string): ModeId {
  // CC status line markers (case-insensitive). Order matters: more specific first.
  const t = text.toLowerCase();
  if (/bypass(\s|ing)? permissions?/.test(t)) return "bypass";
  if (/auto[- ]?(accept )?mode\b/.test(t)) return "auto";
  if (/accept[- ]edits? on/.test(t)) return "acceptEdits";
  if (/plan mode/.test(t)) return "plan";
  return "default";
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const ModeBar: Component<Props> = (props) => {
  const [detected, setDetected] = createSignal<ModeId>("default");
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<string | null>(null);
  const [pollErr, setPollErr] = createSignal(false);

  const poll = async (): Promise<ModeId> => {
    if (document.hidden) return detected();
    if (!props.pane) return "default";
    try {
      const text = await captureTmuxPane(props.pane);
      const m = detectMode(text);
      setDetected(m);
      setPollErr(false);
      return m;
    } catch (e) {
      setPollErr(true);
      return detected();
    }
  };

  // Background poll so external CC mode changes show up in the bar.
  createEffect(() => {
    const pane = props.pane;
    if (!pane) return;
    void poll();
    const id = setInterval(() => {
      if (document.hidden) return;
      if (!busy()) void poll();
    }, POLL_MS);
    onCleanup(() => clearInterval(id));
  });

  const apply = async (target: ModeDef) => {
    if (!props.pane || busy()) return;
    setBusy(true);
    setStatus(null);
    try {
      await sendTmuxKeys(props.pane, ["Escape"]);
      await delay(STEP_DELAY_MS);
      let cur = await poll();
      let steps = 0;
      while (cur !== target.id && steps < MAX_STEPS) {
        await sendTmuxKeys(props.pane, ["BTab"]);
        await delay(STEP_DELAY_MS);
        cur = await poll();
        steps++;
      }
      if (cur === target.id) {
        setStatus(`→ ${target.label}`);
      } else {
        setStatus(`couldn't reach ${target.label} (now ${cur})`);
      }
      setTimeout(() => setStatus(null), 2000);
    } catch (e) {
      setStatus(`failed: ${String(e).slice(0, 60)}`);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!props.pane || busy()) return;
    setBusy(true);
    setStatus(null);
    try {
      await sendTmuxKeys(props.pane, ["Escape"]);
      await delay(STEP_DELAY_MS);
      await poll();
      setStatus("escape sent");
      setTimeout(() => setStatus(null), 1500);
    } catch (e) {
      setStatus(`failed: ${String(e).slice(0, 60)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      class="dc-mode-bar"
      style={{
        flex: "0 0 auto",
        display: "flex",
        "align-items": "center",
        gap: "8px",
        padding: "6px 14px",
        "border-top": "1px solid var(--rule, var(--border-soft))",
        background: "var(--paper-2, var(--surface))",
        "font-size": "11.5px",
        "flex-wrap": "wrap",
      }}
    >
      <span
        style={{
          color: "var(--ink-3, var(--text-3))",
          "font-size": "10.5px",
          "letter-spacing": "0.05em",
          "text-transform": "uppercase",
          "white-space": "nowrap",
        }}
      >
        Mode
      </span>
      <For each={MODES}>
        {(m) => (
          <button
            class={`dc-mode-pill ${detected() === m.id ? "active" : ""}`}
            onClick={() => apply(m)}
            disabled={!props.pane || busy()}
            title={m.hint}
          >
            {m.label}
          </button>
        )}
      </For>
      <Show when={detected() === "bypass"}>
        <span
          class="dc-mode-pill active"
          title="Bypass permissions mode is active (launched with --dangerously-skip-permissions)"
        >
          Bypass
        </span>
      </Show>
      <button
        class="dc-mode-pill ghost"
        onClick={reset}
        disabled={!props.pane || busy()}
        title="Send Escape (close any CC dialog)"
      >
        esc
      </button>
      <Show when={!props.pane}>
        <span class="ink-faint" style={{ "font-style": "italic", "font-size": "11px" }}>
          no tmux pane — mode switch disabled
        </span>
      </Show>
      <Show when={pollErr() && props.pane}>
        <span class="ink-faint" style={{ "font-style": "italic", "font-size": "11px" }}>
          mode detection failed
        </span>
      </Show>
      <Show when={status()}>
        <span
          style={{
            "margin-left": "auto",
            "font-size": "11px",
            color: status()?.startsWith("failed") || status()?.startsWith("couldn't")
              ? "var(--warn, var(--m-warn))"
              : "var(--ok, var(--m-ok))",
          }}
        >
          {status()}
        </span>
      </Show>
    </div>
  );
};

export default ModeBar;
