import { Component, Show } from "solid-js";
import type { UnifiedSession } from "../lib/types";
import DFFrame from "./DFFrame";

interface Props {
  session: UnifiedSession | null;
}

function formatDate(timestamp: string | null, updatedAt: number | null): string {
  const ms = updatedAt ?? (timestamp ? new Date(timestamp).getTime() : 0);
  if (!ms) return "n/a";
  return new Date(ms).toLocaleString();
}

const DetailRow: Component<{ label: string; value: string | null | undefined }> = (props) => (
  <Show when={props.value}>
    <div style={{ "margin-bottom": "6px" }}>
      <div style={{ color: "var(--text-dim)", "font-size": "11px" }}>{props.label}</div>
      <div
        style={{
          color: "var(--text)",
          "word-break": "break-all",
        }}
      >
        {props.value}
      </div>
    </div>
  </Show>
);

const SessionDetail: Component<Props> = (props) => {
  return (
    <DFFrame title="Detail" style={{ flex: 1 }}>
      <Show
        when={props.session}
        fallback={
          <div style={{ color: "var(--text-dim)" }}>No session selected</div>
        }
      >
        {(s) => (
          <div>
            <DetailRow
              label="Source"
              value={s().source === "OpenClaw" ? "OpenClaw" : "Claude Code"}
            />
            <DetailRow label="Model" value={s().model} />
            <DetailRow label="Messages" value={String(s().message_count)} />
            <DetailRow
              label="Updated"
              value={formatDate(s().timestamp, s().updated_at)}
            />
            <DetailRow label="CWD" value={s().cwd} />
            <DetailRow label="Channel" value={s().channel} />
            <DetailRow label="Chat Type" value={s().chat_type} />
            <DetailRow label="Project" value={s().project_path} />
            <DetailRow label="Slug" value={s().slug} />
            <DetailRow label="ID" value={s().id} />
          </div>
        )}
      </Show>
    </DFFrame>
  );
};

export default SessionDetail;
