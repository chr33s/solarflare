import { it, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import { handleDeferredHydrationNode, dedupeDeferredScripts } from "./router-deferred.ts";

type MockScript = {
  tagName: string;
  id?: string;
  textContent?: string | null;
  removed?: boolean;
  getAttribute: (name: string) => string | null;
  remove: () => void;
};

const prevDocument = (globalThis as any).document;
const prevCustomEvent = (globalThis as any).CustomEvent;

afterEach(() => {
  (globalThis as any).document = prevDocument;
  (globalThis as any).CustomEvent = prevCustomEvent;
});

it("dispatches queue event for data-island scripts", () => {
  const events: any[] = [];
  const doc = {
    dispatchEvent: (event: any) => {
      events.push(event);
      return true;
    },
  } as any;

  (globalThis as any).document = doc;
  (globalThis as any).CustomEvent = class MockCustomEvent {
    type: string;
    detail: any;
    constructor(type: string, init?: { detail?: any }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };

  const script: MockScript = {
    tagName: "SCRIPT",
    getAttribute: (name: string) => (name === "data-island" ? "sf-root-deferred-1" : null),
    remove: () => {},
  };

  handleDeferredHydrationNode("sf-root", new Set(), script as unknown as Element);

  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, "sf:queue-hydrate");
  assert.deepStrictEqual(events[0].detail, { tag: "sf-root", id: "sf-root-deferred-1" });
});

it("dispatches queue event from hydration scripts", () => {
  const events: any[] = [];
  const doc = {
    dispatchEvent: (event: any) => {
      events.push(event);
      return true;
    },
  } as any;

  (globalThis as any).document = doc;
  (globalThis as any).CustomEvent = class MockCustomEvent {
    type: string;
    detail: any;
    constructor(type: string, init?: { detail?: any }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };

  const script: MockScript = {
    tagName: "SCRIPT",
    id: "sf-root-hydrate-1",
    textContent: 'detail:{"tag":"sf-root","id":"sf-root-deferred-x"}',
    getAttribute: () => null,
    remove: () => {},
  };

  handleDeferredHydrationNode("sf-root", new Set(), script as unknown as Element);

  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, "sf:queue-hydrate");
  assert.deepStrictEqual(events[0].detail, { tag: "sf-root", id: "sf-root-deferred-x" });
});

it("dedupes deferred scripts", () => {
  const scripts: MockScript[] = [];

  const makeScript = (opts: { id?: string; dataIsland?: string }) => {
    const script: MockScript = {
      tagName: "SCRIPT",
      id: opts.id,
      removed: false,
      getAttribute: (name: string) => (name === "data-island" ? (opts.dataIsland ?? null) : null),
      remove: () => {
        script.removed = true;
      },
    };
    scripts.push(script);
    return script;
  };

  makeScript({ dataIsland: "sf-root-deferred-1" });
  makeScript({ dataIsland: "sf-root-deferred-1" });
  makeScript({ id: "sf-root-hydrate-1" });
  makeScript({ id: "sf-root-hydrate-1" });

  (globalThis as any).document = {
    querySelectorAll: () => scripts,
  } as any;

  dedupeDeferredScripts("sf-root");

  assert.strictEqual(scripts[0].removed, true);
  assert.strictEqual(scripts[2].removed, true);
  assert.strictEqual(scripts[1].removed, false);
  assert.strictEqual(scripts[3].removed, false);
});
