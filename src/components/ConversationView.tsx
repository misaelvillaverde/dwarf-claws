import { Component, For, Show, createEffect } from "solid-js";
import type { UnifiedMessage, ContentBlock } from "../lib/types";
import DFFrame from "./DFFrame";
import MessageBlock from "./MessageBlock";

interface Props {
  messages: UnifiedMessage[];
  loading: boolean;
  sessionName: string | null;
}

const ConversationView: Component<Props> = (props) => {
  let scrollRef: HTMLDivElement | undefined;

  // Build a map of tool_id -> tool_result for pairing
  const toolResults = () => {
    const map = new Map<string, Extract<ContentBlock, { type: "tool_result" }>>();
    for (const msg of props.messages) {
      for (const block of msg.content) {
        if (block.type === "tool_result") {
          map.set(block.tool_id, block);
        }
      }
    }
    return map;
  };

  // Filter out pure tool_result messages (they're shown inline)
  const visibleMessages = () =>
    props.messages.filter((m) => {
      if (m.role === "ToolResult") {
        // Show only if it has text content, not just tool results
        return m.content.some((b) => b.type === "text");
      }
      return true;
    });

  createEffect(() => {
    // Scroll to top when messages change
    if (props.messages.length > 0 && scrollRef) {
      scrollRef.scrollTop = 0;
    }
  });

  return (
    <DFFrame
      title={props.sessionName ? `Conversation - ${props.sessionName}` : "Conversation"}
      style={{ flex: 2 }}
    >
      <div ref={scrollRef} style={{ height: "100%", overflow: "auto" }}>
        <Show
          when={!props.loading}
          fallback={
            <div style={{ color: "var(--text-dim)", padding: "20px", "text-align": "center" }}>
              Loading...
            </div>
          }
        >
          <Show
            when={props.messages.length > 0}
            fallback={
              <div style={{ color: "var(--text-dim)", padding: "20px", "text-align": "center" }}>
                Select a session to view
              </div>
            }
          >
            <For each={visibleMessages()}>
              {(msg) => <MessageBlock message={msg} toolResults={toolResults()} />}
            </For>
          </Show>
        </Show>
      </div>
    </DFFrame>
  );
};

export default ConversationView;
