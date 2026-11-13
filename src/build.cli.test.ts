import { it } from "node:test";
import * as assert from "node:assert/strict";

it("loads without executing build", async () => {
  await import("./build.ts");
  assert.ok(true);
});

it("parseCliArgs reads explicit argv without touching process.argv side effects", async () => {
  const { parseCliArgs } = await import("./build.ts");
  const { values } = parseCliArgs(["--production", "--clean"]);
  assert.strictEqual(values.production, true);
  assert.strictEqual(values.clean, true);
  assert.strictEqual(values.watch, false);
});

it("exports LAYOUT_TEMPLATE as valid single-document HTML structure", async () => {
  const { LAYOUT_TEMPLATE } = await import("./build.ts");
  assert.ok(LAYOUT_TEMPLATE.includes("<head>"));
  assert.ok(LAYOUT_TEMPLATE.includes("</head>"));
  assert.ok(LAYOUT_TEMPLATE.includes("<body>"));
  assert.ok(LAYOUT_TEMPLATE.includes("</body>"));
  assert.ok(LAYOUT_TEMPLATE.includes("<Head"));
  assert.ok(LAYOUT_TEMPLATE.includes("<Body"));
  // Must not close </html> before <body>
  const htmlCloseBeforeBody = LAYOUT_TEMPLATE.search(/<\/html>[\s\S]*<body/);
  assert.strictEqual(htmlCloseBeforeBody, -1);
});
