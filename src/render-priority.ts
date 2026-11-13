import { type VNode, h, Fragment } from "preact";

/** Priority levels for content rendering (reserved for future scheduling). */
export type RenderPriority = "critical" | "high" | "normal" | "low" | "idle";

/**
 * @deprecated Prefer server-loader promise props for deferred streaming.
 * This stub previously emitted unused SF:DEFERRED markers. It now simply
 * renders children (or the fallback when children are missing).
 */
export function Deferred(props: {
  priority?: RenderPriority;
  fallback?: VNode;
  children?: VNode;
}): VNode {
  const { fallback, children } = props;
  return children ?? fallback ?? h(Fragment, null);
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
.sf-loading { min-height: 100px; }
`;
