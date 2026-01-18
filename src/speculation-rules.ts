/** Speculation Rules API types and utilities for prefetch/prerender. */

/** Eagerness levels for speculation. */
export type SpeculationEagerness = "immediate" | "eager" | "moderate" | "conservative";

/** Referrer policy for speculative requests. */
type SpeculationReferrerPolicy =
  | "no-referrer"
  | "no-referrer-when-downgrade"
  | "origin"
  | "origin-when-cross-origin"
  | "same-origin"
  | "strict-origin"
  | "strict-origin-when-cross-origin"
  | "unsafe-url";

/** Document-sourced rule matching anchors. */
export interface DocumentRule {
  source: "document";
  where?: {
    href_matches?: string | string[];
    selector_matches?: string;
    and?: DocumentRule["where"][];
    or?: DocumentRule["where"][];
    not?: DocumentRule["where"];
  };
  eagerness?: SpeculationEagerness;
  referrer_policy?: SpeculationReferrerPolicy;
  expects_no_vary_search?: string;
}

/** List-sourced rule with explicit URLs. */
export interface ListRule {
  source: "list";
  urls: string[];
  eagerness?: SpeculationEagerness;
  referrer_policy?: SpeculationReferrerPolicy;
  expects_no_vary_search?: string;
}

/** Union type for speculation rules. */
export type SpeculationRule = DocumentRule | ListRule;

/** Complete speculation rules object. */
export interface SpeculationRules {
  prefetch?: SpeculationRule[];
  prerender?: SpeculationRule[];
}

/** Checks if Speculation Rules API is supported. */
export function supportsSpeculationRules() {
  return (
    typeof HTMLScriptElement !== "undefined" &&
    HTMLScriptElement.supports?.("speculationrules") === true
  );
}

/** Injects speculation rules into the document head. */
export function injectSpeculationRules(rules: SpeculationRules) {
  if (typeof document === "undefined") return null;

  const script = document.createElement("script");
  script.type = "speculationrules";
  script.textContent = JSON.stringify(rules);
  const head = document.head;
  const existing = head.querySelector('script[type="speculationrules"]');
  if (existing) {
    existing.replaceWith(script);
    return script;
  }

  const range = document.createRange();
  const firstManaged = head.querySelector("[data-sf-head]");
  if (firstManaged) {
    range.setStartBefore(firstManaged);
    range.collapse(true);
  } else {
    range.selectNodeContents(head);
    range.collapse(false);
  }
  range.insertNode(script);
  return script;
}

/** Removes all speculation rules scripts from the document. */
export function clearSpeculationRules() {
  if (typeof document === "undefined") return;

  const scripts = document.querySelectorAll('script[type="speculationrules"]');
  for (const script of scripts) {
    script.remove();
  }
}

/** Creates a list-based prefetch rule. */
export function createPrefetchListRule(
  urls: string[],
  options: Omit<ListRule, "source" | "urls"> = {},
): ListRule {
  return { source: "list", urls, ...options };
}

/** Creates a list-based prerender rule. */
export function createPrerenderListRule(
  urls: string[],
  options: Omit<ListRule, "source" | "urls"> = {},
): ListRule {
  return { source: "list", urls, ...options };
}

/** Creates a document-sourced rule matching href patterns. */
export function createDocumentRule(
  patterns: string | string[],
  options: Omit<DocumentRule, "source" | "where"> = {},
): DocumentRule {
  return {
    source: "document",
    where: { href_matches: patterns },
    ...options,
  };
}

/** Creates a document-sourced rule matching CSS selectors. */
export function createSelectorRule(
  selector: string,
  options: Omit<DocumentRule, "source" | "where"> = {},
): DocumentRule {
  return {
    source: "document",
    where: { selector_matches: selector },
    ...options,
  };
}

/** Builds speculation rules from route patterns. */
export function buildRouteSpeculationRules(
  routes: { pattern: string; prerender?: boolean }[],
  base = "",
): SpeculationRules {
  const prefetchUrls: string[] = [];
  const prerenderUrls: string[] = [];

  for (const route of routes) {
    // Skip dynamic routes (contain : or *)
    if (/[:*]/.test(route.pattern)) continue;

    const url = base + route.pattern;
    if (route.prerender) {
      prerenderUrls.push(url);
    } else {
      prefetchUrls.push(url);
    }
  }

  const rules: SpeculationRules = {};

  if (prefetchUrls.length > 0) {
    rules.prefetch = [createPrefetchListRule(prefetchUrls, { eagerness: "moderate" })];
  }

  if (prerenderUrls.length > 0) {
    rules.prerender = [createPrerenderListRule(prerenderUrls, { eagerness: "moderate" })];
  }

  return rules;
}

/** Generates inline script tag HTML for SSR. */
export function renderSpeculationRulesTag(rules: SpeculationRules) {
  return `<script type="speculationrules">${JSON.stringify(rules)}</script>`;
}
