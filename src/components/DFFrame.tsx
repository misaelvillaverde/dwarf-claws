import { JSX, ParentComponent } from "solid-js";

interface Props {
  title?: string;
  class?: string;
  style?: JSX.CSSProperties;
}

const DFFrame: ParentComponent<Props> = (props) => {
  return (
    <div
      class={props.class}
      style={{
        border: "1px solid var(--border)",
        position: "relative",
        display: "flex",
        "flex-direction": "column",
        overflow: "hidden",
        ...props.style,
      }}
    >
      {props.title && (
        <div
          style={{
            position: "absolute",
            top: "-1px",
            left: "8px",
            background: "var(--bg)",
            padding: "0 4px",
            color: "var(--border-bright)",
            "font-weight": "bold",
            "z-index": 1,
            "line-height": "1",
            transform: "translateY(-50%)",
          }}
        >
          {"[ "}{props.title}{" ]"}
        </div>
      )}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "8px",
          "padding-top": props.title ? "12px" : "8px",
        }}
      >
        {props.children}
      </div>
    </div>
  );
};

export default DFFrame;
