import { Component, For, createSignal } from "solid-js";
import type { UnifiedSession } from "../lib/types";
import DFFrame from "./DFFrame";
import SessionItem from "./SessionItem";

interface Props {
  sessions: UnifiedSession[];
  selectedId: string | null;
  onSelect: (session: UnifiedSession) => void;
  onSearch: (query: string) => void;
  sourceFilter: string | null;
  onFilterChange: (filter: string | null) => void;
}

const SessionList: Component<Props> = (props) => {
  const [searchText, setSearchText] = createSignal("");

  const handleSearch = (val: string) => {
    setSearchText(val);
    props.onSearch(val);
  };

  return (
    <DFFrame title="Sessions" style={{ flex: 1 }}>
      <div
        style={{
          display: "flex",
          gap: "4px",
          "margin-bottom": "6px",
          "flex-wrap": "wrap",
        }}
      >
        <button
          class={props.sourceFilter === null ? "active" : ""}
          onClick={() => props.onFilterChange(null)}
        >
          All
        </button>
        <button
          class={props.sourceFilter === "openclaw" ? "active" : ""}
          onClick={() => props.onFilterChange("openclaw")}
        >
          <span style={{ color: "var(--orange)" }}>OC</span>
        </button>
        <button
          class={props.sourceFilter === "claude_code" ? "active" : ""}
          onClick={() => props.onFilterChange("claude_code")}
        >
          <span style={{ color: "var(--blue)" }}>CC</span>
        </button>
      </div>
      <input
        type="text"
        placeholder="/ search..."
        value={searchText()}
        onInput={(e) => handleSearch(e.currentTarget.value)}
        style={{ width: "100%", "margin-bottom": "6px" }}
      />
      <div style={{ overflow: "auto", flex: 1 }}>
        <For each={props.sessions}>
          {(session) => (
            <SessionItem
              session={session}
              selected={props.selectedId === session.id}
              onClick={() => props.onSelect(session)}
            />
          )}
        </For>
      </div>
    </DFFrame>
  );
};

export default SessionList;
