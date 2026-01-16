import type { NormalizedOutputOptions, OutputBundle } from "rolldown";

export const assetUrlPrefixPlugin = {
  name: "asset-url-prefix",
  generateBundle(_options: NormalizedOutputOptions, bundle: OutputBundle) {
    const assetFileNames = Object.values(bundle)
      .filter((item) => item.type === "asset")
      .map((asset) => asset.fileName);

    if (assetFileNames.length === 0) return;

    for (const item of Object.values(bundle)) {
      if (item.type !== "chunk") continue;
      let { code } = item;

      for (const fileName of assetFileNames) {
        const prefixed = `/assets/${fileName}`;
        code = code
          .replaceAll(`"${fileName}"`, `"${prefixed}"`)
          .replaceAll(`'${fileName}'`, `'${prefixed}'`)
          .replaceAll(`\`${fileName}\``, `\`${prefixed}\``);
      }

      item.code = code;
    }
  },
};
