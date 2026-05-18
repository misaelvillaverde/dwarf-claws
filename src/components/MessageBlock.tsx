import { Component, For, Show, createSignal } from "solid-js";
import type { UnifiedMessage, ContentBlock } from "../lib/types";
import ToolCallBlock from "./ToolCallBlock";
import { renderMarkdown } from "../lib/markdown";

type ToolResultBlock = Extract<ContentBlock, { type: "tool_result" }>;

interface Props {
  message: UnifiedMessage;
  getToolResult: (id: string) => ToolResultBlock | undefined;
  pendingIds?: Set<string>;
  firstPendingId?: string | null;
  pane?: string | null;
  isToolExpanded?: (toolId: string) => boolean;
  onToggleToolExpanded?: (toolId: string) => void;
}

function roleLabel(role: string): string {
  switch (role) {
    case "User": return "you";
    case "Assistant": return "claude";
    case "ToolResult": return "tool";
    default: return role.toLowerCase();
  }
}

function roleColor(role: string): string {
  switch (role) {
    case "User": return "var(--accent)";
    case "Assistant": return "var(--ok)";
    case "ToolResult": return "var(--info)";
    default: return "var(--ink)";
  }
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function shortModel(model: string | null): string {
  if (!model) return "";
  return model.replace("claude-", "").replace("anthropic/", "");
}

const MessageBlock: Component<Props> = (props) => {
  const accent = roleColor(props.message.role);
  return (
    <div style={{ "margin-bottom": "10px" }}>
      <div style={{
        display: "flex",
        "align-items": "baseline",
        gap: "8px",
        "margin-bottom": "2px",
        "font-size": "11px",
        "line-height": 1.3,
      }}>
        <span style={{
          color: accent,
          "font-weight": 600,
          "letter-spacing": "0.04em",
          "text-transform": "lowercase",
        }}>
          {roleLabel(props.message.role)}
        </span>
        <span class="ink-faint" style={{ "font-size": "10.5px" }}>
          {formatTimestamp(props.message.timestamp)}
        </span>
        <Show when={props.message.model}>
          <span class="ink-faint" style={{ "font-size": "10px", "font-style": "italic" }}>
            &middot; {shortModel(props.message.model)}
          </span>
        </Show>
        <span style={{
          flex: 1,
          height: "1px",
          background: "var(--rule-soft)",
          "margin-left": "4px",
        }}></span>
      </div>
      <div style={{
        "border-left": `2px solid ${accent}`,
        "padding-left": "10px",
        "min-width": 0,
      }}>
        <For each={props.message.content}>
          {(block) => (
            <BlockRenderer
              block={block}
              getToolResult={props.getToolResult}
              pendingIds={props.pendingIds}
              firstPendingId={props.firstPendingId}
              pane={props.pane}
              messageTs={props.message.timestamp}
              isToolExpanded={props.isToolExpanded}
              onToggleToolExpanded={props.onToggleToolExpanded}
            />
          )}
        </For>
      </div>
    </div>
  );
};

const BlockRenderer: Component<{
  block: ContentBlock;
  getToolResult: (id: string) => ToolResultBlock | undefined;
  pendingIds?: Set<string>;
  firstPendingId?: string | null;
  pane?: string | null;
  messageTs?: string | null;
  isToolExpanded?: (toolId: string) => boolean;
  onToggleToolExpanded?: (toolId: string) => void;
}> = (props) => {
  switch (props.block.type) {
    case "text":
      return (
        <div
          class="md"
          style={{
            color: "var(--ink, var(--m-text))",
            "word-break": "break-word",
            margin: "2px 0 4px",
          }}
          innerHTML={renderMarkdown(props.block.text)}
        />
      );
    case "thinking": {
      const [show, setShow] = createSignal(false);
      const wordCount = props.block.text.split(/\s+/).length;
      return (
        <div style={{ margin: "4px 0", "font-size": "11.5px" }}>
          <span
            onClick={() => setShow(!show())}
            class="ink-faint"
            style={{
              cursor: "pointer",
              "font-style": "italic",
              "user-select": "none",
            }}
          >
            {show() ? "▾" : "▸"} thinking &middot; {wordCount} words
          </span>
          <Show when={show()}>
            <pre style={{
              margin: "4px 0 4px 12px",
              color: "var(--ink-3)",
              "font-style": "italic",
              "white-space": "pre-wrap",
              "font-size": "11px",
              "border-left": "1px dotted var(--rule)",
              "padding-left": "8px",
            }}>
              {props.block.text}
            </pre>
          </Show>
        </div>
      );
    }
    case "tool_call": {
      const id = props.block.tool_id;
      const pending = !!props.pendingIds?.has(id);
      const ts = props.messageTs ? Date.parse(props.messageTs) : 0;
      return (
        <ToolCallBlock
          block={props.block}
          result={props.getToolResult(id)}
          pending={pending}
          firstPending={pending && props.firstPendingId === id}
          pane={props.pane ?? null}
          ts={isNaN(ts) ? 0 : ts}
          isExpanded={props.isToolExpanded}
          onToggleExpanded={props.onToggleToolExpanded}
        />
      );
    }
    case "tool_result":
      return null;
    default:
      return null;
  }
};

export default MessageBlock;
