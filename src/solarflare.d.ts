interface ImportMeta {
  glob<T = { default: unknown }>(
    pattern: string,
    options?: { eager?: boolean },
  ): Record<string, () => Promise<T>>;
  /** The file path of the current module (Node runtime) */
  path?: string;
  /** Environment variables replaced at build time via `transform.define` in `rolldown.config.ts`. */
  env: {
    DEV?: boolean;
    PROD?: boolean;
    MODE?: string;
  } & Record<string, string>;
}

declare module "*.css" {
  const classNames: Record<string, string>;
  export default classNames;
}

declare module "*.gif" {
  const image: string;
  export default image;
}

declare module "*.html" {
  const html: string;
  export default html;
}

declare module "*.ico" {
  const image: string;
  export default image;
}

declare module "*.jpeg" {
  const image: string;
  export default image;
}

declare module "*.jpg" {
  const image: string;
  export default image;
}

declare module "*.png" {
  const image: string;
  export default image;
}

declare module "*.svg" {
  const image: any;
  export default image;
}

/**
 * Solarflare Framework Types
 */
declare module "@chr33s/solarflare/client" {
  import { FunctionComponent, VNode } from "preact";

  export type RenderPriority = "critical" | "high" | "normal" | "low" | "idle";

  export function Deferred(props: {
    priority?: RenderPriority;
    fallback?: VNode;
    children: VNode;
  }): VNode;

  export interface DefineOptions {
    tag?: string;
    shadow?: boolean;
    observedAttributes?: string[];
    validate?: boolean;
  }

  export function define<P extends Record<string, any>>(
    Component: FunctionComponent<P>,
    options?: DefineOptions,
  ): FunctionComponent<P>;

  export interface NavigateOptions {
    replace?: boolean;
    state?: unknown;
    skipTransition?: boolean;
  }

  export function navigate(to: string | URL, options?: NavigateOptions): Promise<void>;
}

declare module "@chr33s/solarflare/server" {
  import { VNode } from "preact";

  export function Body(): VNode<any>;
  export function Head(): VNode<any>;
}

declare module "@chr33s/solarflare" {
  export default function worker(request: Request, env: Env): Promise<Response>;
}
