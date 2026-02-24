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
  shadow?: boolean;
}

function buildDebugImports(args: HmrEntryArgs) {
  if (!args.debug) return "";
  return /* tsx */ `
      import 'preact/debug'
      import '@preact/signals-debug'
    `;
}

function buildRouterInit(routesManifest: RoutesManifest) {
  return `const routesManifest = ${JSON.stringify(routesManifest)};`;
}

function buildStylesheetRegistration(meta: ComponentMeta, cssFiles: string[], args: HmrEntryArgs) {
  if (!cssFiles.length || args.production) {
    return { imports: "", setup: "" };
  }

  const cssImports = cssFiles.map((file, i) => `import css${i} from '${file}?raw';`).join("\n");
  const inlineStyles = cssFiles.map((file, i) => `{ id: '${file}', css: css${i} }`).join(", ");

  return {
    imports: /* tsx */ `
          import { registerInlineStyles } from '@chr33s/solarflare/client';
          ${cssImports}
        `,
    setup: /* tsx */ `
        registerInlineStyles('${meta.tag}', [${inlineStyles}]);
      `,
  };
}

function buildEntryInit(meta: ComponentMeta, cssFiles: string[]) {
  return /* tsx */ `
    initHmrEntry({
      tag: '${meta.tag}',
      props: ${JSON.stringify(meta.props)},${meta.shadow ? `\n      shadow: true,` : ""}
      routesManifest,
      BaseComponent,
      hmr,
      cssFiles: ${JSON.stringify(cssFiles)},
      onCssUpdate: reloadAllStylesheets,
    });
  `;
}

export function generateChunkedClientEntry(
  meta: ComponentMeta,
  routesManifest: RoutesManifest,
  cssFiles: string[] = [],
  args: HmrEntryArgs,
) {
  const debugImports = buildDebugImports(args);
  const { imports: stylesheetImports, setup: stylesheetSetup } = buildStylesheetRegistration(
    meta,
    cssFiles,
    args,
  );
  const routesManifestInit = buildRouterInit(routesManifest);
  const entryInit = buildEntryInit(meta, cssFiles);

  return /* tsx */ `
    /** Auto-generated: ${meta.chunk} */
    ${debugImports}
    import { initHmrEntry, hmr, reloadAllStylesheets } from '@chr33s/solarflare/client';
    ${stylesheetImports}
    import BaseComponent from '../src/${meta.file}';

    ${stylesheetSetup}

    ${routesManifestInit}

    ${entryInit}
  `;
}
