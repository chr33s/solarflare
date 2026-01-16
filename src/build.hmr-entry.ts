import type { RoutesManifest } from "./manifest.ts";

export interface HmrEntryArgs {
  production: boolean;
  debug: boolean;
}

export interface ComponentMeta {
  file: string;
  tag: string;
  props: string[];
  chunk: string;
}

export function generateChunkedClientEntry(
  meta: ComponentMeta,
  routesManifest: RoutesManifest,
  cssFiles: string[] = [],
  args: HmrEntryArgs,
): string {
  const debugImports = args.debug
    ? /* tsx */ `
      import 'preact/debug'
      import '@preact/signals-debug'
    `
    : "";

  const inlinedRoutes = JSON.stringify(routesManifest);

  const cssImports = args.production
    ? ""
    : cssFiles.map((file, i) => `import css${i} from '${file}?raw';`).join("\n");

  const cssRegistrations = args.production
    ? ""
    : cssFiles
        .map(
          (file, i) => /* tsx */ `
        const preloaded${i} = getPreloadedStylesheet('${file}');
        if (!preloaded${i}) {
          stylesheets.register('${file}', css${i}, { consumer: '${meta.tag}' });
        }
      `,
        )
        .join("");

  const stylesheetImports =
    cssFiles.length > 0 && !args.production
      ? /* tsx */ `
          import { stylesheets, supportsConstructableStylesheets, getPreloadedStylesheet } from '@chr33s/solarflare/client';
          ${cssImports}
        `
      : "";

  const stylesheetSetup =
    cssFiles.length > 0 && !args.production
      ? /* tsx */ `
        if (supportsConstructableStylesheets()) {
          ${cssRegistrations}

          const sheets = stylesheets.getForConsumer('${meta.tag}');
          document.adoptedStyleSheets = [
            ...document.adoptedStyleSheets.filter(s => !sheets.includes(s)),
            ...sheets
          ];
        }
      `
      : "";

  return /* tsx */ `
    /** Auto-generated: ${meta.chunk} */
    ${debugImports}
    import register from 'preact-custom-element';
    import { initHmrEntry, hmr } from '@chr33s/solarflare/client';${stylesheetImports}
    import BaseComponent from '../src/${meta.file}';

    ${stylesheetSetup}

    function reloadStylesheets() {
      // Find all stylesheets and bust their cache
      const links = document.querySelectorAll('link[rel="stylesheet"]');
      links.forEach(link => {
        const href = link.getAttribute('href');
        if (href && !href.includes('?')) {
          link.setAttribute('href', href + '?t=' + Date.now());
        } else if (href) {
          link.setAttribute('href', href.replace(/\\?t=\\d+/, '?t=' + Date.now()));
        }
      });
      console.log('[HMR] Reloaded stylesheets');
    }

    const routesManifest = ${inlinedRoutes};

    initHmrEntry({
      tag: '${meta.tag}',
      props: ${JSON.stringify(meta.props)},
      routesManifest,
      BaseComponent,
      hmr,
      cssFiles: ${JSON.stringify(cssFiles)},
      onCssUpdate: reloadStylesheets,
    });
  `;
}
