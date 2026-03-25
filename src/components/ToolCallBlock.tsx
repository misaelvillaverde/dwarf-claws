import { Component, createSignal, Show } from "solid-js";
import type { ContentBlock } from "../lib/types";

interface Props {
  block: Extract<ContentBlock, { type: "tool_call" }>;
  result?: Extract<ContentBlock, { type: "tool_result" }>;
}

const ToolCallBlock: Component<Props> = (props) => {
  const [expanded, setExpanded] = createSignal(false);

  const inputPreview = () => {
    try {
      const parsed = JSON.parse(props.block.input);
      const keys = Object.keys(parsed);
      if (keys.length === 0) return "";
      return keys
        .map((k) => {
          const v = parsed[k];
          const vs = typeof v === "string" ? v : JSON.stringify(v);
          return `${k}: ${vs.length > 50 ? vs.slice(0, 50) + "..." : vs}`;
        })
        .join(", ");
    } catch {
      return props.block.input.slice(0, 80);
    }
  };

  return (
    <div
      style={{
        "margin": "4px 0",
        "border": "1px solid #335",
        "background": "#0a0a14",
      }}
    >
      <div
        onClick={() => setExpanded(!expanded())}
        style={{
          padding: "2px 6px",
          cursor: "pointer",
          color: "var(--cyan)",
          display: "flex",
          gap: "6px",
          "align-items": "center",
        }}
      >
        <span style={{ color: "var(--text-dim)" }}>
          {expanded() ? "[-]" : "[+]"}
        </span>
        <span style={{ "font-weight": "bold" }}>{props.block.tool_name}</span>
        <Show when={!expanded()}>
          <span
            style={{
              color: "var(--text-dim)",
              "font-size": "12px",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
            }}
          >
            {inputPreview()}
          </span>
        </Show>
      </div>
      <Show when={expanded()}>
        <div
          style={{
            padding: "4px 6px",
            "border-top": "1px solid #335",
            "font-size": "12px",
          }}
        >
          <div style={{ color: "var(--text-dim)", "margin-bottom": "2px" }}>
            Input:
          </div>
          <pre
            style={{
              color: "var(--cyan)",
              "white-space": "pre-wrap",
              "word-break": "break-all",
              "max-height": "200px",
              overflow: "auto",
            }}
          >
            {(() => {
              try {
                return JSON.stringify(JSON.parse(props.block.input), null, 2);
              } catch {
                return props.block.input;
              }
            })()}
          </pre>
          <Show when={props.result}>
            <div
              style={{
                "margin-top": "6px",
                color: "var(--text-dim)",
                "margin-bottom": "2px",
              }}
            >
              {props.result!.is_error ? "Error:" : "Output:"}
            </div>
            <pre
              style={{
                color: props.result!.is_error ? "var(--red)" : "var(--text)",
                "white-space": "pre-wrap",
                "word-break": "break-all",
                "max-height": "200px",
                overflow: "auto",
              }}
            >
              {props.result!.output}
            </pre>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default ToolCallBlock;
