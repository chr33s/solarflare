import { getHeadContext, HEAD_MARKER } from "./head.ts";

/** Marker for asset injection during streaming. */
export const BODY_MARKER = "<!--SOLARFLARE_BODY-->";

/** Generates asset HTML tags for injection. */
export function generateAssetTags(script?: string, styles?: string[], devScripts?: string[]) {
  let html = "";

  // Add stylesheet links
  if (styles && styles.length > 0) {
    for (const href of styles) {
      html += /* html */ `<link rel="stylesheet" href="${href}">`;
    }
  }

  // Add dev mode scripts (like console forwarding)
  if (devScripts && devScripts.length > 0) {
    for (const src of devScripts) {
      html += /* html */ `<script src="${src}" async></script>`;
    }
  }

  // Add script tag
  if (script) {
    html += /* html */ `<script type="module" src="${script}" async></script>`;
  }

  return html;
}

/** Transforms stream to inject assets, head tags, and store hydration. */
export function createAssetInjectionTransformer(
  storeScript: string,
  script?: string,
  styles?: string[],
  devScripts?: string[],
): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let doctypeInjected = false;
  let headInjected = false;
  const bodyMarker = /* html */ `<solarflare-body>${BODY_MARKER}</solarflare-body>`;
  const headMarker = HEAD_MARKER;

  function replaceHeadMarker(html: string) {
    const markerIndex = html.indexOf(headMarker);
    if (markerIndex === -1) return { html, replaced: false };

    const templateStart = html.lastIndexOf("<template", markerIndex);
    if (templateStart !== -1) {
      const tagEnd = html.indexOf(">", templateStart);
      if (tagEnd !== -1) {
        const openTag = html.slice(templateStart, tagEnd + 1);
        const templateEnd = html.indexOf("</template>", markerIndex);
        if (openTag.includes("data-sf-head") && templateEnd !== -1) {
          const replaced =
            html.slice(0, templateStart) +
            getHeadContext().renderToString() +
            html.slice(templateEnd + "</template>".length);
          return { html: replaced, replaced: true };
        }
      }
    }

    return { html: html.replace(headMarker, getHeadContext().renderToString()), replaced: true };
  }

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      // Inject <!doctype html> before the root <html> tag (only once)
      if (!doctypeInjected) {
        const htmlIndex = buffer.indexOf("<html");
        if (htmlIndex !== -1) {
          buffer = buffer.slice(0, htmlIndex) + "<!doctype html>" + buffer.slice(htmlIndex);
          doctypeInjected = true;
        }
      }

      // Inject head tags at Head marker (only once)
      if (!headInjected) {
        const result = replaceHeadMarker(buffer);
        buffer = result.html;
        headInjected = result.replaced;
      }

      // Check if we have the complete body marker
      const markerIndex = buffer.indexOf(bodyMarker);
      if (markerIndex !== -1) {
        // Generate replacement content
        const assetTags = generateAssetTags(script, styles, devScripts);

        // Replace marker with assets + store hydration
        buffer = buffer.replace(bodyMarker, assetTags + storeScript);

        // Flush everything before and including the replacement
        controller.enqueue(encoder.encode(buffer));
        buffer = "";
      } else if (buffer.length > bodyMarker.length * 2) {
        // If buffer is getting large and no marker found, flush safe portion
        const safeLength = buffer.length - bodyMarker.length;
        controller.enqueue(encoder.encode(buffer.slice(0, safeLength)));
        buffer = buffer.slice(safeLength);
      }
    },
    flush(controller) {
      // Flush any remaining content
      if (buffer) {
        // Inject doctype if not done yet (edge case: small document)
        if (!doctypeInjected) {
          const htmlIndex = buffer.indexOf("<html");
          if (htmlIndex !== -1) {
            buffer = buffer.slice(0, htmlIndex) + "<!doctype html>" + buffer.slice(htmlIndex);
          }
        }
        // Final check for head marker in remaining content
        if (!headInjected) {
          const result = replaceHeadMarker(buffer);
          buffer = result.html;
          headInjected = result.replaced;
        }
        // Final check for body marker in remaining content
        const markerIndex = buffer.indexOf(bodyMarker);
        if (markerIndex !== -1) {
          const assetTags = generateAssetTags(script, styles, devScripts);
          buffer = buffer.replace(bodyMarker, assetTags + storeScript);
        }
        controller.enqueue(encoder.encode(buffer));
      }
    },
  });
}
