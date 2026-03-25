import { Component } from "solid-js";

interface Props {
  ocCount: number;
  ccCount: number;
}

const StatusBar: Component<Props> = (props) => {
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        padding: "2px 8px",
        "border-top": "1px solid var(--border)",
        color: "var(--text-dim)",
        "font-size": "12px",
        gap: "16px",
        "flex-shrink": 0,
      }}
    >
      <span>
        <span style={{ color: "var(--orange)" }}>OC</span>:{props.ocCount}
      </span>
      <span>
        <span style={{ color: "var(--blue)" }}>CC</span>:{props.ccCount}
      </span>
      <span style={{ "margin-left": "auto" }}>
        Total: {props.ocCount + props.ccCount} sessions
      </span>
    </div>
  );
};

export default StatusBar;
