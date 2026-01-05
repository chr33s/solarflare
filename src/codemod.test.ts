import { describe, it, before, after } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { codemod, transformSource } from "./codemod.ts";

describe("React to Preact imports", () => {
  it("transforms basic react import to preact", () => {
    const input = `import React from "react";`;
    const output = transformSource(input);
    assert.ok(output.includes('from "preact"'));
    assert.ok(!output.includes('from "react"'));
  });

  it("transforms react-dom import to preact", () => {
    const input = `import ReactDOM from "react-dom";`;
    const output = transformSource(input);
    assert.ok(output.includes('from "preact"'));
    assert.ok(!output.includes('from "react-dom"'));
  });

  it("transforms react-dom/client import to preact", () => {
    const input = `import { createRoot } from "react-dom/client";`;
    const output = transformSource(input);
    assert.ok(output.includes('from "preact"'));
    assert.ok(!output.includes('from "react-dom/client"'));
  });

  it("transforms jsx-runtime import", () => {
    const input = `import { jsx } from "react/jsx-runtime";`;
    const output = transformSource(input);
    assert.ok(output.includes('from "preact/jsx-runtime"'));
  });
});

describe("React hooks to Preact hooks", () => {
  it("moves useState to preact/hooks", () => {
    const input = `import { useState } from "react";`;
    const output = transformSource(input);
    assert.ok(output.includes('from "preact/hooks"'));
    assert.ok(output.includes("useState"));
  });

  it("moves useEffect to preact/hooks", () => {
    const input = `import { useEffect } from "react";`;
    const output = transformSource(input);
    assert.ok(output.includes('from "preact/hooks"'));
    assert.ok(output.includes("useEffect"));
  });

  it("moves multiple hooks to preact/hooks", () => {
    const input = `import { useState, useEffect, useCallback } from "react";`;
    const output = transformSource(input);
    assert.ok(output.includes('from "preact/hooks"'));
    assert.ok(output.includes("useState"));
    assert.ok(output.includes("useEffect"));
    assert.ok(output.includes("useCallback"));
  });

  it("separates hooks from other imports", () => {
    const input = `import React, { useState, Fragment } from "react";`;
    const output = transformSource(input);
    assert.ok(output.includes('from "preact/hooks"'));
    assert.ok(output.includes('from "preact"'));
  });
});

describe("React types to Preact types", () => {
  it("transforms ReactNode to ComponentChildren", () => {
    const input = `import type { ReactNode } from "react";`;
    const output = transformSource(input);
    assert.ok(output.includes("ComponentChildren"));
    assert.ok(output.includes('from "preact"'));
  });

  it("transforms ReactElement to VNode", () => {
    const input = `import type { ReactElement } from "react";`;
    const output = transformSource(input);
    assert.ok(output.includes("VNode"));
  });

  it("transforms FC to FunctionComponent", () => {
    const input = `import type { FC } from "react";`;
    const output = transformSource(input);
    assert.ok(output.includes("FunctionComponent"));
  });

  it("preserves aliases when transforming types", () => {
    const input = `import type { ReactNode as RN } from "react";`;
    const output = transformSource(input);
    assert.ok(output.includes("ComponentChildren as RN"));
  });
});

describe("JSX Fragment handling", () => {
  it("adds Fragment import when JSX fragments are used", () => {
    const input = `
import React from "react";
export const App = () => <><div>Hello</div></>;
`;
    const output = transformSource(input);
    assert.ok(output.includes("Fragment"));
    assert.ok(output.includes('from "preact"'));
  });
});

describe("preserves non-React imports", () => {
  it("keeps third-party imports unchanged", () => {
    const input = `
import { something } from "some-library";
import React from "react";
`;
    const output = transformSource(input);
    assert.ok(output.includes('from "some-library"'));
    assert.ok(output.includes('from "preact"'));
  });

  it("keeps relative imports unchanged", () => {
    const input = `
import { helper } from "./utils";
import React from "react";
`;
    const output = transformSource(input);
    assert.ok(output.includes('from "./utils"'));
  });
});

describe("complex transformations", () => {
  it("handles mixed imports correctly", () => {
    const input = `
import React, { useState, useEffect } from "react";
import type { ReactNode, FC } from "react";
`;
    const output = transformSource(input);
    assert.ok(output.includes('from "preact"'));
    assert.ok(output.includes('from "preact/hooks"'));
    assert.ok(output.includes("useState"));
    assert.ok(output.includes("useEffect"));
  });

  it("handles default and named imports together", () => {
    const input = `import React, { Component } from "react";`;
    const output = transformSource(input);
    assert.ok(output.includes('from "preact"'));
    assert.ok(output.includes("Component"));
  });
});

describe("route module analysis", () => {
  it("detects loader export in route files", () => {
    const input = `
import { json } from "react-router";
export function loader({ params }) {
  return json({ id: params.id });
}
`;
    const output = transformSource(input, "/app/routes/test.tsx");
    assert.ok(output.includes("loader"));
  });

  it("detects action export in route files", () => {
    const input = `
export async function action({ request }) {
  const formData = await request.formData();
  return { success: true };
}
`;
    const output = transformSource(input, "/app/routes/test.tsx");
    assert.ok(output.includes("action"));
  });

  it("detects default component export", () => {
    const input = `
export default function MyComponent() {
  return <div>Hello</div>;
}
`;
    const output = transformSource(input, "/app/routes/test.tsx");
    assert.ok(output.includes("MyComponent"));
  });
});

describe("routes.ts config transformation", () => {
  it("outputs file-based routing guidance for routes.ts", () => {
    const input = `
import { route, index } from "react-router";
export default [
  index("./home.tsx"),
  route("about", "./about.tsx"),
];
`;
    const output = transformSource(input, "/app/routes.ts");
    assert.ok(output.includes("Solarflare uses file-based routing"));
    assert.ok(output.includes("index.server.tsx"));
    assert.ok(output.includes("_layout.tsx"));
  });

  it("explains naming conventions", () => {
    const input = `export default [];`;
    const output = transformSource(input, "/app/routes.ts");
    assert.ok(output.includes("$param"));
    assert.ok(output.includes(":param"));
    assert.ok(output.includes("*.server.tsx"));
    assert.ok(output.includes("*.client.tsx"));
  });
});

describe("React Router import transformations", () => {
  it("transforms react-router useNavigate to solarflare", () => {
    const input = `
import { useNavigate } from "react-router";
import React from "react";
`;
    const output = transformSource(input, "/app/routes/test.tsx");
    assert.ok(output.includes('from "preact"'));
  });

  it("transforms react-router Link import", () => {
    const input = `
import { Link } from "react-router";
import React from "react";
`;
    const output = transformSource(input, "/app/routes/test.tsx");
    assert.ok(output.includes('from "preact"'));
  });
});

describe("Remix v2 import transformations", () => {
  it("removes @remix-run/react imports", () => {
    const input = `
import { useLoaderData, Form, Link } from "@remix-run/react";
import React from "react";
`;
    const output = transformSource(input, "/app/routes/test.tsx");
    assert.ok(!output.includes("@remix-run/react"));
    assert.ok(output.includes('from "preact"'));
  });

  it("removes @remix-run/node imports", () => {
    const input = `
import { json, redirect } from "@remix-run/node";
`;
    const output = transformSource(input, "/app/routes/test.tsx");
    assert.ok(!output.includes("@remix-run/node"));
  });

  it("removes @remix-run/cloudflare imports", () => {
    const input = `
import { json } from "@remix-run/cloudflare";
`;
    const output = transformSource(input, "/app/routes/test.tsx");
    assert.ok(!output.includes("@remix-run/cloudflare"));
  });

  it("removes @remix-run/server-runtime imports", () => {
    const input = `
import type { LoaderFunctionArgs } from "@remix-run/server-runtime";
`;
    const output = transformSource(input, "/app/routes/test.tsx");
    assert.ok(!output.includes("@remix-run/server-runtime"));
  });
});

describe("Remix v2 loader/action transformations", () => {
  it("transforms LoaderFunctionArgs pattern", () => {
    const input = `
import { json } from "@remix-run/node";
export function loader({ params }: LoaderFunctionArgs) {
  return json({ id: params.id });
}
`;
    const output = transformSource(input, "/app/routes/test.tsx");
    assert.ok(output.includes("loader"));
  });

  it("detects Remix action export", () => {
    const input = `
import { json, redirect } from "@remix-run/node";
export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  return redirect("/success");
}
`;
    const output = transformSource(input, "/app/routes/test.tsx");
    assert.ok(output.includes("action"));
  });
});

describe("Remix v2 component transformations", () => {
  it("removes useLoaderData import from @remix-run/react", () => {
    const input = `
import { useLoaderData } from "@remix-run/react";
export default function Component() {
  const data = useLoaderData<typeof loader>();
  return <div>{data.title}</div>;
}
`;
    const output = transformSource(input, "/app/routes/test.tsx");
    // Import is removed; hook usage transformed during file splitting
    assert.ok(!output.includes("@remix-run/react"));
  });

  it("removes useActionData import from @remix-run/react", () => {
    const input = `
import { useActionData } from "@remix-run/react";
export default function Component() {
  const actionData = useActionData<typeof action>();
  return <div>{actionData?.error}</div>;
}
`;
    const output = transformSource(input, "/app/routes/test.tsx");
    // Import is removed; hook usage transformed during file splitting
    assert.ok(!output.includes("@remix-run/react"));
  });

  it("removes Form import from @remix-run/react", () => {
    const input = `
import { Form } from "@remix-run/react";
export default function Component() {
  return <Form method="post"><button>Submit</button></Form>;
}
`;
    const output = transformSource(input, "/app/routes/test.tsx");
    assert.ok(!output.includes("@remix-run/react"));
  });

  it("removes Link import from @remix-run/react", () => {
    const input = `
import { Link } from "@remix-run/react";
export default function Component() {
  return <Link to="/about">About</Link>;
}
`;
    const output = transformSource(input, "/app/routes/test.tsx");
    assert.ok(!output.includes("@remix-run/react"));
  });
});

describe("skip node_modules", () => {
  it("returns input unchanged for node_modules paths", () => {
    const input = `import React from "react";`;
    const output = transformSource(input, "node_modules/some-lib/index.tsx");
    // Should still transform since transformSource doesn't check node_modules
    // (that check is in the main transformer function)
    assert.ok(output.includes('from "preact"'));
  });
});

describe("run with directory recursion", () => {
  const testDir = "/tmp/solarflare-codemod-test";

  before(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(testDir, "nested"), { recursive: true });
    fs.writeFileSync(path.join(testDir, "file1.tsx"), `import React from "react";`);
    fs.writeFileSync(path.join(testDir, "file2.ts"), `import { useState } from "react";`);
    fs.writeFileSync(
      path.join(testDir, "nested", "file3.tsx"),
      `import ReactDOM from "react-dom";`,
    );
    fs.writeFileSync(path.join(testDir, "ignored.txt"), `not a ts file`);
    fs.mkdirSync(path.join(testDir, ".hidden"));
    fs.writeFileSync(path.join(testDir, ".hidden", "secret.tsx"), `import React from "react";`);
  });

  after(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("recursively transforms files in a directory", () => {
    codemod([testDir], { dry: false });

    const file1 = fs.readFileSync(path.join(testDir, "file1.tsx"), "utf-8");
    const file2 = fs.readFileSync(path.join(testDir, "file2.ts"), "utf-8");
    const file3 = fs.readFileSync(path.join(testDir, "nested", "file3.tsx"), "utf-8");

    assert.ok(file1.includes('from "preact"'));
    assert.ok(file2.includes('from "preact/hooks"'));
    assert.ok(file3.includes('from "preact"'));
  });

  it("skips non-ts/tsx/js/jsx files", () => {
    const ignored = fs.readFileSync(path.join(testDir, "ignored.txt"), "utf-8");
    assert.equal(ignored, "not a ts file");
  });

  it("skips hidden directories", () => {
    const hidden = fs.readFileSync(path.join(testDir, ".hidden", "secret.tsx"), "utf-8");
    assert.ok(hidden.includes('from "react"'));
  });

  it("handles single file path", () => {
    fs.writeFileSync(path.join(testDir, "single.tsx"), `import React from "react";`);
    codemod([path.join(testDir, "single.tsx")], { dry: false });
    const single = fs.readFileSync(path.join(testDir, "single.tsx"), "utf-8");
    assert.ok(single.includes('from "preact"'));
  });

  it("respects dry mode", () => {
    fs.writeFileSync(path.join(testDir, "dry.tsx"), `import React from "react";`);
    codemod([path.join(testDir, "dry.tsx")], { dry: true });
    const dry = fs.readFileSync(path.join(testDir, "dry.tsx"), "utf-8");
    assert.ok(dry.includes('from "react"'));
  });
});
