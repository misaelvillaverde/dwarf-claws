import { Component, For, Show, createSignal } from "solid-js";
import type { CcQuestion } from "../lib/types";
import { sendTmuxKeys, sendToTmuxPane } from "../lib/api";

interface Props {
  question: CcQuestion;
  pane: string;
  onDismiss: () => void;
}

const QuestionBar: Component<Props> = (props) => {
  const [freetextMode, setFreetextMode] = createSignal(false);
  const [freetextValue, setFreetextValue] = createSignal("");
  const [sending, setSending] = createSignal(false);
  let textRef: HTMLInputElement | undefined;

  const selectOption = async (num: number, isFreetext: boolean) => {
    if (sending()) return;
    setSending(true);
    try {
      await sendTmuxKeys(props.pane, [num.toString()]);
      if (isFreetext) {
        setFreetextMode(true);
        queueMicrotask(() => textRef?.focus());
      } else {
        props.onDismiss();
      }
    } catch (e) {
      console.error("send option failed:", e);
    } finally {
      setSending(false);
    }
  };

  const submitFreetext = async () => {
    const text = freetextValue().trim();
    if (!text || sending()) return;
    setSending(true);
    try {
      await sendToTmuxPane(props.pane, text);
      props.onDismiss();
    } catch (e) {
      console.error("send freetext failed:", e);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{
      "border-top": "1px solid var(--rule)",
      background: "var(--paper-2)",
      padding: "8px 12px",
      "flex-shrink": 0,
    }}>
      <div style={{
        display: "flex",
        "align-items": "center",
        gap: "8px",
        "margin-bottom": "6px",
      }}>
        <span style={{
          "font-size": "10.5px",
          "letter-spacing": "0.06em",
          "text-transform": "uppercase",
          color: "var(--ink-3)",
        }}>
          ┄ question
        </span>
        <button
          class="btn-ghost"
          style={{ "font-size": "10px", "margin-left": "auto" }}
          onClick={props.onDismiss}
          title="dismiss"
        >
          ✕
        </button>
      </div>

      <div style={{
        "font-size": "12.5px",
        color: "var(--ink)",
        "font-weight": 500,
        "margin-bottom": "8px",
      }}>
        {props.question.prompt}
      </div>

      <Show
        when={freetextMode()}
        fallback={
          <div style={{ display: "flex", "flex-direction": "column", gap: "3px" }}>
            <For each={props.question.options}>
              {(opt) => (
                <button
                  disabled={sending()}
                  onClick={() => selectOption(opt.number, opt.is_freetext)}
                  style={{
                    "text-align": "left",
                    display: "flex",
                    "align-items": "flex-start",
                    gap: "8px",
                    padding: "5px 8px",
                    width: "100%",
                    cursor: sending() ? "not-allowed" : "pointer",
                  }}
                >
                  <span style={{
                    color: "var(--info)",
                    "font-size": "11px",
                    "min-width": "16px",
                    "padding-top": "1px",
                    "flex-shrink": 0,
                  }}>
                    {opt.number}.
                  </span>
                  <span style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>
                    <span style={{ color: "var(--ink)", "font-size": "12px" }}>
                      {opt.label}
                    </span>
                    <Show when={opt.description}>
                      <span style={{
                        color: "var(--ink-3)",
                        "font-size": "10.5px",
                        "font-style": "italic",
                        "line-height": "1.4",
                      }}>
                        {opt.description}
                      </span>
                    </Show>
                  </span>
                </button>
              )}
            </For>
          </div>
        }
      >
        <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
          <input
            ref={textRef}
            type="text"
            value={freetextValue()}
            onInput={(e) => setFreetextValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submitFreetext();
              }
              if (e.key === "Escape") props.onDismiss();
            }}
            placeholder="type your answer · ⌘↵ to send"
            disabled={sending()}
            style={{
              flex: 1,
              "font-size": "12px",
              padding: "5px 8px",
              background: "var(--paper-3)",
              border: "1px solid var(--rule)",
              color: "var(--ink)",
            }}
          />
          <button
            onClick={submitFreetext}
            disabled={sending() || !freetextValue().trim()}
          >
            {sending() ? "sending…" : "send ⌘↵"}
          </button>
        </div>
      </Show>
    </div>
  );
};

export default QuestionBar;
