import { getDeferredIslandPrefix, getHydrateScriptPrefix } from "./hydration.ts";

/**
 * Handles deferred hydration script and island insertion during streamed navigation.
 */
export function handleDeferredHydrationNode(
  entryTag: string,
  processedScripts: Set<string>,
  node: Element,
) {
  const hydratePrefix = getHydrateScriptPrefix(entryTag);
  const islandPrefix = getDeferredIslandPrefix(entryTag);

  const processHydrationScript = (script: HTMLScriptElement) => {
    const scriptId = script.id;
    if (!scriptId || !scriptId.startsWith(hydratePrefix)) return;
    if (processedScripts.has(scriptId)) return;
    processedScripts.add(scriptId);

    // Parse the hydration detail from the script content
    // Format: detail:{"tag":"sf-root","id":"sf-root-deferred-defer-xxx"}
    const scriptContent = script.textContent;
    if (scriptContent) {
      const match = scriptContent.match(/detail:(\{[^}]+\})/);
      if (match) {
        try {
          const detail = JSON.parse(match[1]) as { tag: string; id: string };
          document.dispatchEvent(new CustomEvent("sf:queue-hydrate", { detail }));
          return;
        } catch {
          // Fallback: script will execute naturally when inserted
        }
      }
    }
  };

  const processDataIsland = (script: HTMLScriptElement) => {
    const id = script.getAttribute("data-island");
    if (!id || !id.startsWith(islandPrefix)) return;
    const islandKey = `island:${id}`;
    if (processedScripts.has(islandKey)) return;
    processedScripts.add(islandKey);
    document.dispatchEvent(
      new CustomEvent("sf:queue-hydrate", {
        detail: { tag: entryTag, id },
      }),
    );
  };

  if (node.tagName === "SCRIPT") {
    const script = node as HTMLScriptElement;
    processHydrationScript(script);
    processDataIsland(script);
    return;
  }

  // Also scan descendants in case a container node was inserted
  const scripts = node.querySelectorAll("script");
  for (const script of scripts) {
    processHydrationScript(script as HTMLScriptElement);
    processDataIsland(script as HTMLScriptElement);
  }
}

export function dedupeDeferredScripts(entryTag: string) {
  const islandPrefix = getDeferredIslandPrefix(entryTag);
  const hydratePrefix = getHydrateScriptPrefix(entryTag);
  const scripts = document.querySelectorAll(
    `script[data-island^="${islandPrefix}"], script[id^="${hydratePrefix}"]`,
  );
  const seen = new Map<string, HTMLScriptElement>();

  for (const script of scripts) {
    const dataIsland = script.getAttribute("data-island");
    const key = dataIsland ? `island:${dataIsland}` : script.id ? `hydrate:${script.id}` : null;

    if (!key) continue;

    const previous = seen.get(key);
    if (previous) {
      previous.remove();
    }
    seen.set(key, script as HTMLScriptElement);
  }
}
