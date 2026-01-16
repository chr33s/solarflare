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

  const inlineStyles = args.production
    ? ""
    : cssFiles.map((file, i) => `{ id: '${file}', css: css${i} }`).join(", ");

  const stylesheetImports =
    cssFiles.length > 0 && !args.production
      ? /* tsx */ `
          import { registerInlineStyles } from '@chr33s/solarflare/client';
          ${cssImports}
        `
      : "";

  const stylesheetSetup =
    cssFiles.length > 0 && !args.production
      ? /* tsx */ `
        registerInlineStyles('${meta.tag}', [${inlineStyles}]);
      `
      : "";

  return /* tsx */ `
    /** Auto-generated: ${meta.chunk} */
    ${debugImports}
    import { initHmrEntry, hmr, reloadAllStylesheets } from '@chr33s/solarflare/client';${stylesheetImports}
    import BaseComponent from '../src/${meta.file}';

    ${stylesheetSetup}

    const routesManifest = ${inlinedRoutes};

    initHmrEntry({
      tag: '${meta.tag}',
      props: ${JSON.stringify(meta.props)},
      routesManifest,
      BaseComponent,
      hmr,
      cssFiles: ${JSON.stringify(cssFiles)},
      onCssUpdate: reloadAllStylesheets,
    });
  `;
}
