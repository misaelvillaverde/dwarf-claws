import { Component, For, Show, createSignal } from "solid-js";
import type { UnifiedMessage, ContentBlock } from "../lib/types";
import ToolCallBlock from "./ToolCallBlock";

interface Props {
  message: UnifiedMessage;
  toolResults: Map<string, Extract<ContentBlock, { type: "tool_result" }>>;
}

function roleLabel(role: string): string {
  switch (role) {
    case "User": return "USER";
    case "Assistant": return "ASST";
    case "ToolResult": return "TOOL";
    default: return role;
  }
}

function roleColor(role: string): string {
  switch (role) {
    case "User": return "var(--green)";
    case "Assistant": return "var(--yellow)";
    case "ToolResult": return "var(--cyan)";
    default: return "var(--text)";
  }
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function shortModel(model: string | null): string {
  if (!model) return "";
  return model
    .replace("claude-", "")
    .replace("anthropic/", "");
}

const MessageBlock: Component<Props> = (props) => {
  return (
    <div style={{ "margin-bottom": "12px" }}>
      <div
        style={{
          display: "flex",
          gap: "8px",
          "margin-bottom": "2px",
          "align-items": "baseline",
        }}
      >
        <span
          style={{
            color: roleColor(props.message.role),
            "font-weight": "bold",
          }}
        >
          [{roleLabel(props.message.role)}]
        </span>
        <span style={{ color: "var(--text-dim)", "font-size": "12px" }}>
          {formatTimestamp(props.message.timestamp)}
        </span>
        <Show when={props.message.model}>
          <span style={{ color: "var(--text-dim)", "font-size": "11px" }}>
            {shortModel(props.message.model)}
          </span>
        </Show>
      </div>
      <div style={{ "padding-left": "4px" }}>
        <For each={props.message.content}>
          {(block) => <BlockRenderer block={block} toolResults={props.toolResults} />}
        </For>
      </div>
    </div>
  );
};

const BlockRenderer: Component<{
  block: ContentBlock;
  toolResults: Map<string, Extract<ContentBlock, { type: "tool_result" }>>;
}> = (props) => {
  switch (props.block.type) {
    case "text":
      return (
        <pre
          style={{
            "white-space": "pre-wrap",
            "word-break": "break-word",
            margin: 0,
          }}
        >
          {props.block.text}
        </pre>
      );
    case "thinking": {
      const [show, setShow] = createSignal(false);
      return (
        <div style={{ margin: "4px 0" }}>
          <span
            onClick={() => setShow(!show())}
            style={{
              color: "var(--text-dim)",
              cursor: "pointer",
              "font-style": "italic",
            }}
          >
            {show() ? "[-] thinking..." : "[+] thinking..."}
          </span>
          <Show when={show()}>
            <pre
              style={{
                color: "var(--text-dim)",
                "white-space": "pre-wrap",
                "word-break": "break-word",
                "max-height": "300px",
                overflow: "auto",
                "border-left": "2px solid #333",
                "padding-left": "8px",
                margin: "4px 0",
              }}
            >
              {props.block.text}
            </pre>
          </Show>
        </div>
      );
    }
    case "tool_call":
      return (
        <ToolCallBlock
          block={props.block}
          result={props.toolResults.get(props.block.tool_id)}
        />
      );
    case "tool_result":
      // Tool results are shown inline with their tool_call
      return null;
    default:
      return null;
  }
};

export default MessageBlock;
