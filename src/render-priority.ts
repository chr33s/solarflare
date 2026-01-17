import { type VNode, h, Fragment } from "preact";

/** Priority levels for content rendering. */
export type RenderPriority = "critical" | "high" | "normal" | "low" | "idle";

/** Creates a deferred rendering boundary. */
export function Deferred(props: {
  priority?: RenderPriority;
  fallback?: VNode;
  children: VNode;
}): VNode {
  const { priority = "normal", fallback, children } = props;

  // On server, we render a placeholder that gets replaced
  if (typeof window === "undefined") {
    const id = `sf-deferred-${Math.random().toString(36).slice(2, 9)}`;

    return h(Fragment, null, [
      h(
        "sf-deferred",
        {
          id,
          "data-priority": priority,
          style: { display: "contents" },
        },
        fallback ?? h("div", { class: "sf-loading" }),
      ),
      h("template", {
        "data-sf-deferred": id,
        dangerouslySetInnerHTML: { __html: `<!--SF: DEFERRED:${id}-->` },
      }),
    ]);
  }

  return children;
}

/** Skeleton loader component. */
export function Skeleton(props: {
  width?: string;
  height?: string;
  variant?: "text" | "rect" | "circle";
  count?: number;
}): VNode {
  const { width = "100%", height = "1em", variant = "text", count = 1 } = props;

  const style = {
    width,
    height,
    backgroundColor: "#e0e0e0",
    borderRadius: variant === "circle" ? "50%" : variant === "text" ? "4px" : "0",
    animation: "sf-skeleton-pulse 1.5s ease-in-out infinite",
  };

  const items = Array.from({ length: count }, (_, i) =>
    h("div", { key: i, class: "sf-skeleton", style }),
  );

  return h(Fragment, null, items);
}

/** Injects skeleton animation CSS. */
export const SKELETON_CSS = /* css */ `
@keyframes sf-skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
. sf-loading { min-height: 100px; }
`;
