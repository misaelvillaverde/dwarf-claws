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
        display: "flex",
        "flex-direction": "column",
        overflow: "hidden",
        ...props.style,
      }}
    >
      {props.title && (
        <div
          style={{
            padding: "2px 8px",
            color: "var(--border-bright)",
            "font-weight": "bold",
            "font-size": "12px",
            "line-height": "1.4",
            "flex-shrink": 0,
            "border-bottom": "1px solid var(--border)",
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
          display: "flex",
          "flex-direction": "column",
          "min-height": 0,
        }}
      >
        {props.children}
      </div>
    </div>
  );
};

export default DFFrame;
