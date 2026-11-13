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

    // Prefer durable data-* attributes shared with the server serializer.
    const dataTag = script.getAttribute("data-tag");
    const dataId = script.getAttribute("data-id");
    if (dataTag && dataId) {
      document.dispatchEvent(
        new CustomEvent("sf:queue-hydrate", { detail: { tag: dataTag, id: dataId } }),
      );
      return;
    }

    // Legacy fallback: scrape detail:{...} from inline script text
    const scriptContent = script.textContent;
    if (scriptContent) {
      const marker = "detail:";
      const start = scriptContent.indexOf(marker);
      if (start !== -1) {
        const jsonStart = start + marker.length;
        if (scriptContent[jsonStart] === "{") {
          let depth = 0;
          let end = -1;
          for (let i = jsonStart; i < scriptContent.length; i++) {
            const ch = scriptContent[i];
            if (ch === "{") depth++;
            else if (ch === "}") {
              depth--;
              if (depth === 0) {
                end = i + 1;
                break;
              }
            }
          }
          if (end !== -1) {
            try {
              const detail = JSON.parse(scriptContent.slice(jsonStart, end)) as {
                tag: string;
                id: string;
              };
              document.dispatchEvent(new CustomEvent("sf:queue-hydrate", { detail }));
              return;
            } catch {
              // Fallback: script will execute naturally when inserted
            }
          }
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
