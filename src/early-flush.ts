/** Generates resource hints for critical assets. */
export function generateResourceHints(options: {
  scripts?: string[];
  stylesheets?: string[];
  preconnect?: string[];
  dnsPrefetch?: string[];
}) {
  const hints: string[] = [];

  for (const origin of options.preconnect ?? []) {
    hints.push(/* html */ `<link rel="preconnect" href="${origin}" crossorigin>`);
  }

  for (const origin of options.dnsPrefetch ?? []) {
    hints.push(/* html */ `<link rel="dns-prefetch" href="${origin}">`);
  }

  for (const href of options.stylesheets ?? []) {
    hints.push(/* html */ `<link rel="preload" href="${href}" as="style">`);
  }

  for (const href of options.scripts ?? []) {
    hints.push(/* html */ `<link rel="modulepreload" href="${href}">`);
  }

  return hints.join("\n");
}
