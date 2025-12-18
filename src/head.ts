/** Document head management for SSR and client-side updates. */
import { type VNode, h, type ComponentChildren, options } from "preact";
import { signal, type Signal } from "@preact/signals";

// ============================================================================
// Types
// ============================================================================

/** Supported head tag names. */
export type HeadTagName = "title" | "meta" | "link" | "script" | "base" | "style" | "noscript";

/** Tag priority for ordering. */
export type TagPriority = "critical" | "high" | number | "low";

/** Tag position in the document. */
export type TagPosition = "head" | "bodyOpen" | "bodyClose";

/** Base head tag structure. */
export interface HeadTag {
  /** Tag name. */
  tag: HeadTagName;
  /** Tag attributes/props. */
  props: Record<string, string | boolean | null | undefined>;
  /** Inner content (for title, script, style). */
  textContent?: string;
  /** Deduplication key (auto-generated or manual). */
  key?: string;
  /** Priority for ordering (lower = earlier). */
  tagPriority?: TagPriority;
  /** Position in document. */
  tagPosition?: TagPosition;
  /** Internal: calculated weight for sorting. */
  _w?: number;
  /** Internal: entry position. */
  _p?: number;
  /** Internal: dedupe key. */
  _d?: string;
}

/** Head input schema (similar to unhead). */
export interface HeadInput {
  /** Document title. */
  title?: string;
  /** Title template (function or string with %s). */
  titleTemplate?: string | ((title?: string) => string);
  /** Base element. */
  base?: { href?: string; target?: string };
  /** Meta tags. */
  meta?: Array<{
    charset?: string;
    name?: string;
    property?: string;
    "http-equiv"?: string;
    content?: string;
    key?: string;
  }>;
  /** Link tags. */
  link?: Array<{
    rel?: string;
    href?: string;
    type?: string;
    sizes?: string;
    media?: string;
    crossorigin?: string;
    as?: string;
    key?: string;
  }>;
  /** Script tags. */
  script?: Array<{
    src?: string;
    type?: string;
    async?: boolean;
    defer?: boolean;
    innerHTML?: string;
    key?: string;
  }>;
  /** Style tags. */
  style?: Array<{
    type?: string;
    media?: string;
    innerHTML?: string;
    key?: string;
  }>;
  /** HTML element attributes. */
  htmlAttrs?: Record<string, string>;
  /** Body element attributes. */
  bodyAttrs?: Record<string, string>;
}

/** Active head entry with lifecycle methods. */
export interface ActiveHeadEntry {
  /** Update the head entry. */
  patch: (input: Partial<HeadInput>) => void;
  /** Remove the head entry. */
  dispose: () => void;
}

/** Head entry options. */
export interface HeadEntryOptions {
  /** Priority of tags. */
  tagPriority?: TagPriority;
  /** Position of tags. */
  tagPosition?: TagPosition;
}

// ============================================================================
// Constants
// ============================================================================

/** Tags that can only appear once. */
const UNIQUE_TAGS = new Set(["base", "title", "titleTemplate", "htmlAttrs", "bodyAttrs"]);

/** Head tag names that should be hoisted. */
const HEAD_TAG_NAMES = new Set<string>([
  "title",
  "meta",
  "link",
  "script",
  "base",
  "style",
  "noscript",
]);

/** Tags with inner content. */
const TAGS_WITH_CONTENT = new Set(["title", "script", "style", "noscript"]);

/** Self-closing tags. */
const SELF_CLOSING_TAGS = new Set(["meta", "link", "base"]);

/** Standard meta tags that should always deduplicate (not allow multiples). */
const SINGLE_VALUE_META = new Set(["viewport", "description", "keywords", "robots", "charset"]);

/** Tag weight map for sorting (lower = earlier in head). */
const TAG_WEIGHTS: Record<string, number> = {
  base: 1,
  title: 10,
  meta: 20, // charset/viewport get special handling
  link: 30,
  style: 40,
  script: 50,
  noscript: 60,
};

/** Priority aliases. */
const PRIORITY_ALIASES: Record<string, number> = {
  critical: -80,
  high: -10,
  low: 50,
};

// ============================================================================
// VNode Hoisting (Auto-hoist head tags)
// ============================================================================

/**
 * Extracts text content from VNode children.
 * @param children - VNode children to extract text from
 * @returns Concatenated text content
 */
function getTextContent(children: ComponentChildren): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(getTextContent).join("");
  return "";
}

/** Tracks whether we're inside a <head> element to avoid double-processing. */
let insideHeadElement = false;

/** Whether head hoisting has been installed. */
let hoistingInstalled = false;

/** Installs the VNode hook to automatically hoist head tags. */
export function installHeadHoisting(): void {
  if (hoistingInstalled) return;
  hoistingInstalled = true;

  // Store the previous vnode hook (if any)
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const prevVnode = options.vnode;

  options.vnode = (vnode: VNode) => {
    // Call previous hook first
    if (prevVnode) prevVnode(vnode);

    const type = vnode.type;

    // Track when we enter/exit the <head> element
    if (type === "head") {
      insideHeadElement = true;
      return;
    }

    // Skip if inside the static <head> element (those are already in the document)
    if (insideHeadElement) return;

    // Check if this is a head tag that should be hoisted
    if (typeof type === "string" && HEAD_TAG_NAMES.has(type)) {
      // Extract the head input from this vnode
      const input = vnodeToHeadInput(vnode);
      if (input) {
        // Register with head context
        const ctx = headContext;
        if (ctx) {
          ctx.push(input);
        }
        // Replace the vnode with null to prevent it from rendering in place
        vnode.type = NullComponent;
        (vnode as VNode<{ children?: ComponentChildren }>).props = { children: null };
      }
    }
  };
}

/** Component that renders nothing. */
function NullComponent(): null {
  return null;
}

/**
 * Converts a VNode to HeadInput.
 * @param vnode - VNode to convert
 * @returns HeadInput or null if not a head tag
 */
function vnodeToHeadInput(vnode: VNode): HeadInput | null {
  const type = vnode.type;
  const props = (vnode.props || {}) as Record<string, unknown>;

  if (typeof type !== "string") return null;

  switch (type) {
    case "title":
      return { title: getTextContent(props.children as ComponentChildren) };
    case "meta": {
      const { children: _, ...metaProps } = props;
      return { meta: [metaProps as NonNullable<HeadInput["meta"]>[number]] };
    }
    case "link": {
      const { children: _, ...linkProps } = props;
      return { link: [linkProps as NonNullable<HeadInput["link"]>[number]] };
    }
    case "script": {
      const { children, ...scriptProps } = props;
      return {
        script: [
          {
            ...scriptProps,
            innerHTML: getTextContent(children as ComponentChildren),
          } as NonNullable<HeadInput["script"]>[number],
        ],
      };
    }
    case "style": {
      const { children, ...styleProps } = props;
      return {
        style: [
          {
            ...styleProps,
            innerHTML: getTextContent(children as ComponentChildren),
          } as NonNullable<HeadInput["style"]>[number],
        ],
      };
    }
    case "base": {
      const { children: _, ...baseProps } = props;
      return { base: baseProps as HeadInput["base"] };
    }
    case "noscript":
      // noscript is less common, just skip for now
      return null;
    default:
      return null;
  }
}

/** Resets head element tracking (call between SSR requests). */
export function resetHeadElementTracking(): void {
  insideHeadElement = false;
}

// ============================================================================
// Head Context (Server-side collection)
// ============================================================================

/** Global head context for SSR. */
let headContext: HeadContext | null = null;

/** Head context for collecting tags during render. */
export interface HeadContext {
  /** Collected head entries. */
  entries: HeadEntry[];
  /** Title template. */
  titleTemplate?: string | ((title?: string) => string);
  /** HTML attributes. */
  htmlAttrs: Record<string, string>;
  /** Body attributes. */
  bodyAttrs: Record<string, string>;
  /** Add a head entry. */
  push: (input: HeadInput, options?: HeadEntryOptions) => ActiveHeadEntry;
  /** Resolve all tags with deduplication and sorting. */
  resolveTags: () => HeadTag[];
  /** Render tags to HTML string. */
  renderToString: () => string;
  /** Reset context. */
  reset: () => void;
}

/** Internal head entry. */
interface HeadEntry {
  id: number;
  input: HeadInput;
  options?: HeadEntryOptions;
  _tags?: HeadTag[];
}

let entryId = 0;

/**
 * Creates a new head context.
 * @returns Fresh HeadContext instance
 */
export function createHeadContext(): HeadContext {
  const entries: HeadEntry[] = [];
  const htmlAttrs: Record<string, string> = {};
  const bodyAttrs: Record<string, string> = {};

  const context: HeadContext = {
    entries,
    titleTemplate: undefined,
    htmlAttrs,
    bodyAttrs,

    push(input: HeadInput, options?: HeadEntryOptions): ActiveHeadEntry {
      const id = ++entryId;
      const entry: HeadEntry = { id, input, options };
      entries.push(entry);

      // Handle title template
      if (input.titleTemplate) {
        context.titleTemplate = input.titleTemplate;
      }

      // Handle HTML/body attrs
      if (input.htmlAttrs) {
        Object.assign(htmlAttrs, input.htmlAttrs);
      }
      if (input.bodyAttrs) {
        Object.assign(bodyAttrs, input.bodyAttrs);
      }

      return {
        patch: (newInput: Partial<HeadInput>) => {
          entry.input = { ...entry.input, ...newInput };
          entry._tags = undefined; // Clear cached tags
        },
        dispose: () => {
          const idx = entries.findIndex((e) => e.id === id);
          if (idx !== -1) entries.splice(idx, 1);
        },
      };
    },

    resolveTags(): HeadTag[] {
      // Normalize all entries to tags
      for (const entry of entries) {
        if (!entry._tags) {
          entry._tags = normalizeInputToTags(entry.input, entry.options);
        }
      }

      // Flatten all tags
      const allTags = entries.flatMap((e) => e._tags || []);

      // Apply title template
      if (context.titleTemplate) {
        const titleTag = allTags.find((t) => t.tag === "title");
        if (titleTag?.textContent) {
          const template = context.titleTemplate;
          titleTag.textContent =
            typeof template === "function"
              ? template(titleTag.textContent)
              : template.replace("%s", titleTag.textContent);
        }
      }

      // Assign weights and positions
      allTags.forEach((tag, i) => {
        tag._w = tagWeight(tag);
        tag._p = i;
        tag._d = dedupeKey(tag);
      });

      // Deduplicate: last wins for same dedupe key
      const tagMap = new Map<string, HeadTag>();
      for (const tag of allTags) {
        const key = tag._d || String(tag._p);
        tagMap.set(key, tag);
      }

      // Sort by weight
      return Array.from(tagMap.values()).sort((a, b) => (a._w ?? 100) - (b._w ?? 100));
    },

    renderToString(): string {
      const tags = context.resolveTags();
      return tags.map(tagToHtml).join("\n");
    },

    reset() {
      entries.length = 0;
      context.titleTemplate = undefined;
      Object.keys(htmlAttrs).forEach((k) => delete htmlAttrs[k]);
      Object.keys(bodyAttrs).forEach((k) => delete bodyAttrs[k]);
    },
  };

  return context;
}

/** Resets the entry ID counter (call between SSR requests to prevent overflow). */
export function resetEntryIdCounter(): void {
  entryId = 0;
}

/**
 * Gets or creates the global head context.
 * @returns Global HeadContext instance
 */
export function getHeadContext(): HeadContext {
  if (!headContext) {
    headContext = createHeadContext();
  }
  return headContext;
}

/**
 * Sets the global head context (for SSR).
 * @param ctx - HeadContext to set, or null to clear
 */
export function setHeadContext(ctx: HeadContext | null): void {
  headContext = ctx;
}

/** Resets the global head context. */
export function resetHeadContext(): void {
  if (headContext) {
    headContext.reset();
  }
  // Reset entry ID counter to prevent overflow in long-running scenarios
  resetEntryIdCounter();
}

// ============================================================================
// Deduplication
// ============================================================================

/**
 * Generates dedupe key for a tag.
 * @param tag - HeadTag to generate key for
 * @returns Dedupe key or undefined if not deduplicatable
 */
export function dedupeKey(tag: HeadTag): string | undefined {
  const { props, tag: name } = tag;

  // Unique singleton tags
  if (UNIQUE_TAGS.has(name)) {
    return name;
  }

  // Manual key
  if (tag.key) {
    return `${name}:key:${tag.key}`;
  }

  // Canonical link
  if (name === "link" && props.rel === "canonical") {
    return "canonical";
  }

  // Charset meta
  if (props.charset) {
    return "charset";
  }

  // Meta tags dedupe by name/property/http-equiv
  if (name === "meta") {
    for (const attr of ["name", "property", "http-equiv"]) {
      const value = props[attr];
      if (value !== undefined) {
        // Structured properties (og:image:width) or standard single-value metas dedupe
        const isStructured = typeof value === "string" && value.includes(":");
        const isSingleValue = SINGLE_VALUE_META.has(String(value));
        if (isStructured || isSingleValue || !tag.key) {
          return `meta:${value}`;
        }
        return `meta:${value}:key:${tag.key}`;
      }
    }
  }

  // Link tags with id
  if (props.id) {
    return `${name}:id:${props.id}`;
  }

  // Content-based dedupe for script/style
  if (TAGS_WITH_CONTENT.has(name) && tag.textContent) {
    return `${name}:content:${hashString(tag.textContent)}`;
  }

  return undefined;
}

/**
 * Simple string hash for content-based deduplication.
 * @param str - String to hash
 * @returns Hash string
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}

// ============================================================================
// Tag Weight/Sorting
// ============================================================================

/**
 * Calculates tag weight for sorting.
 * @param tag - HeadTag to calculate weight for
 * @returns Numeric weight (lower = earlier in head)
 */
export function tagWeight(tag: HeadTag): number {
  // Priority overrides
  if (typeof tag.tagPriority === "number") {
    return tag.tagPriority;
  }
  if (tag.tagPriority && tag.tagPriority in PRIORITY_ALIASES) {
    return PRIORITY_ALIASES[tag.tagPriority];
  }

  // Base weight by tag type
  let weight = TAG_WEIGHTS[tag.tag] ?? 100;

  // Special handling for critical meta tags
  if (tag.tag === "meta") {
    if (tag.props.charset) return 1; // charset first
    if (tag.props.name === "viewport") return 2;
    if (tag.props["http-equiv"] === "content-security-policy") return 3;
  }

  // Preload/preconnect links should be early
  if (tag.tag === "link") {
    const rel = tag.props.rel;
    if (rel === "preconnect") return 5;
    if (rel === "dns-prefetch") return 6;
    if (rel === "preload") return 7;
    if (rel === "prefetch") return 35;
  }

  return weight;
}

// ============================================================================
// Normalization
// ============================================================================

/**
 * Normalizes HeadInput to HeadTag array.
 * @param input - HeadInput to normalize
 * @param options - Optional entry options
 * @returns Array of HeadTag objects
 */
export function normalizeInputToTags(input: HeadInput, options?: HeadEntryOptions): HeadTag[] {
  const tags: HeadTag[] = [];

  // Title
  if (input.title) {
    tags.push({
      tag: "title",
      props: {},
      textContent: input.title,
      tagPriority: options?.tagPriority,
    });
  }

  // Base
  if (input.base) {
    tags.push({
      tag: "base",
      props: input.base,
      tagPriority: options?.tagPriority,
    });
  }

  // Meta
  if (input.meta) {
    for (const meta of input.meta) {
      const { key, ...props } = meta;
      tags.push({
        tag: "meta",
        props,
        key,
        tagPriority: options?.tagPriority,
      });
    }
  }

  // Link
  if (input.link) {
    for (const link of input.link) {
      const { key, ...props } = link;
      tags.push({
        tag: "link",
        props,
        key,
        tagPriority: options?.tagPriority,
      });
    }
  }

  // Script
  if (input.script) {
    for (const script of input.script) {
      const { key, innerHTML, ...props } = script;
      tags.push({
        tag: "script",
        props,
        textContent: innerHTML,
        key,
        tagPriority: options?.tagPriority,
      });
    }
  }

  // Style
  if (input.style) {
    for (const style of input.style) {
      const { key, innerHTML, ...props } = style;
      tags.push({
        tag: "style",
        props,
        textContent: innerHTML,
        key,
        tagPriority: options?.tagPriority,
      });
    }
  }

  return tags;
}

// ============================================================================
// HTML Rendering
// ============================================================================

/**
 * Escapes HTML entities in attribute values.
 * @param str - String to escape
 * @returns Escaped string
 */
function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Escapes HTML content.
 * @param str - String to escape
 * @returns Escaped string
 */
function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Renders a HeadTag to HTML string.
 * @param tag - HeadTag to render
 * @returns HTML string
 */
export function tagToHtml(tag: HeadTag): string {
  const attrs = Object.entries(tag.props)
    .filter(([_, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => (v === true ? k : `${k}="${escapeAttr(String(v))}"`))
    .join(" ");

  const attrStr = attrs ? ` ${attrs}` : "";

  if (SELF_CLOSING_TAGS.has(tag.tag)) {
    return `<${tag.tag}${attrStr}>`;
  }

  const content = tag.textContent
    ? tag.tag === "script" || tag.tag === "style"
      ? tag.textContent // Don't escape script/style content
      : escapeHtml(tag.textContent)
    : "";

  return `<${tag.tag}${attrStr}>${content}</${tag.tag}>`;
}

// ============================================================================
// useHead Composable
// ============================================================================

/**
 * Registers head tags (works on both server and client).
 * @param input - Head input configuration
 * @param options - Optional entry options
 * @returns Active entry with patch/dispose methods
 */
export function useHead(input: HeadInput, options?: HeadEntryOptions): ActiveHeadEntry {
  const ctx = getHeadContext();
  const entry = ctx.push(input, options);

  // On client, apply immediately
  if (typeof window !== "undefined") {
    applyHeadToDOM(ctx.resolveTags());
  }

  return entry;
}

// ============================================================================
// Client-Side DOM Updates
// ============================================================================

/** Managed head tags signal for client-side reactivity. */
const managedTags: Signal<Set<Element>> = signal(new Set());

/**
 * Applies head tags to the DOM.
 * @param tags - Array of HeadTags to apply
 */
export function applyHeadToDOM(tags: HeadTag[]): void {
  if (typeof document === "undefined") return;

  const head = document.head;
  const newManagedTags = new Set<Element>();

  // Track existing managed elements
  const existingByKey = new Map<string, Element>();
  for (const el of managedTags.value) {
    const key = el.getAttribute("data-sf-head");
    if (key) {
      existingByKey.set(key, el);
    }
  }

  for (const tag of tags) {
    const key = tag._d || `${tag.tag}:${tag._p}`;

    // Check for existing element with same key
    const existing = existingByKey.get(key);
    if (existing) {
      // Update existing element
      updateElement(existing, tag);
      newManagedTags.add(existing);
      existingByKey.delete(key);
    } else {
      // Create new element
      const el = createElementFromTag(tag);
      el.setAttribute("data-sf-head", key);
      head.appendChild(el);
      newManagedTags.add(el);
    }
  }

  // Remove orphaned managed elements
  for (const el of existingByKey.values()) {
    el.remove();
  }

  // Handle title separately (not managed via data-sf-head)
  const titleTag = tags.find((t) => t.tag === "title");
  if (titleTag?.textContent) {
    document.title = titleTag.textContent;
  }

  managedTags.value = newManagedTags;
}

/**
 * Creates a DOM element from a HeadTag.
 * @param tag - HeadTag to create element from
 * @returns DOM Element
 */
function createElementFromTag(tag: HeadTag): Element {
  const el = document.createElement(tag.tag);

  for (const [key, value] of Object.entries(tag.props)) {
    if (value === undefined || value === null || value === false) continue;
    if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }

  if (tag.textContent) {
    el.textContent = tag.textContent;
  }

  return el;
}

/**
 * Updates an existing DOM element with new tag props.
 * @param el - Element to update
 * @param tag - HeadTag with new values
 */
function updateElement(el: Element, tag: HeadTag): void {
  // Update attributes
  for (const [key, value] of Object.entries(tag.props)) {
    if (value === undefined || value === null || value === false) {
      el.removeAttribute(key);
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }

  // Remove attributes not in new tag
  const newKeys = new Set(Object.keys(tag.props));
  for (const attr of Array.from(el.attributes)) {
    if (!newKeys.has(attr.name) && attr.name !== "data-sf-head") {
      el.removeAttribute(attr.name);
    }
  }

  // Update content
  if (tag.textContent !== undefined) {
    el.textContent = tag.textContent;
  }
}

// ============================================================================
// SSR Marker for Head Injection
// ============================================================================

/** Marker for head tag injection during streaming. */
export const HEAD_MARKER = "<!--SOLARFLARE_HEAD-->";

/**
 * Head component - renders marker for SSR head injection.
 * Place in your layout's <head> where dynamic head tags should be injected.
 * @example
 * <head>
 *   <meta charset="UTF-8" />
 *   <Head />
 *   <Assets />
 * </head>
 */
export function Head(): VNode<any> {
  return h("solarflare-head", { dangerouslySetInnerHTML: { __html: HEAD_MARKER } });
}

/** @deprecated Use Head instead */
export const HeadOutlet = Head;

// ============================================================================
// Serialization for Hydration
// ============================================================================

/**
 * Serializes head state for client hydration.
 * @returns JSON string of head state
 */
export function serializeHeadState(): string {
  const ctx = getHeadContext();
  const state = {
    entries: ctx.entries.map((e) => ({ input: e.input, options: e.options })),
    titleTemplate: ctx.titleTemplate
      ? typeof ctx.titleTemplate === "function"
        ? ctx.titleTemplate.toString()
        : ctx.titleTemplate
      : undefined,
    htmlAttrs: ctx.htmlAttrs,
    bodyAttrs: ctx.bodyAttrs,
  };
  return JSON.stringify(state);
}

/**
 * Hydrates head state on client.
 * @param serialized - Serialized head state JSON
 */
export function hydrateHeadState(serialized: string): void {
  try {
    const state = JSON.parse(serialized);
    const ctx = getHeadContext();
    ctx.reset();

    if (state.titleTemplate) {
      // Note: function templates won't survive serialization properly
      ctx.titleTemplate = state.titleTemplate;
    }
    Object.assign(ctx.htmlAttrs, state.htmlAttrs);
    Object.assign(ctx.bodyAttrs, state.bodyAttrs);

    for (const entry of state.entries) {
      ctx.push(entry.input, entry.options);
    }
  } catch {
    // Ignore parse errors
  }
}
