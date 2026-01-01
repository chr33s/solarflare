import { test, describe } from "node:test";
import assert from "node:assert";
import {
  isDevToolsRequest,
  handleDevToolsRequest,
  setDevToolsUuid,
  type DevToolsJSON,
} from "./devtools-json.ts";

describe("isDevToolsRequest", () => {
  test("returns true for correct endpoint with GET method", () => {
    const request = new Request(
      "http://localhost:8080/.well-known/appspecific/com.chrome.devtools.json",
      { method: "GET" },
    );
    assert.strictEqual(isDevToolsRequest(request), true);
  });

  test("returns false for incorrect path", () => {
    const request = new Request("http://localhost:8080/other-path", {
      method: "GET",
    });
    assert.strictEqual(isDevToolsRequest(request), false);
  });

  test("returns false for POST method", () => {
    const request = new Request(
      "http://localhost:8080/.well-known/appspecific/com.chrome.devtools.json",
      { method: "POST" },
    );
    assert.strictEqual(isDevToolsRequest(request), false);
  });

  test("returns false for partial path match", () => {
    const request = new Request("http://localhost:8080/.well-known/appspecific", {
      method: "GET",
    });
    assert.strictEqual(isDevToolsRequest(request), false);
  });
});

describe("handleDevToolsRequest", () => {
  test("returns JSON response with correct content-type", () => {
    const response = handleDevToolsRequest({ projectRoot: "/test/project" });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get("Content-Type"), "application/json");
  });

  test("returns workspace with root and uuid", async () => {
    const response = handleDevToolsRequest({ projectRoot: "/test/project" });
    const json = (await response.json()) as DevToolsJSON;
    assert.ok(json.workspace);
    assert.strictEqual(json.workspace.root, "/test/project");
    assert.ok(json.workspace.uuid);
    assert.match(
      json.workspace.uuid,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  test("uses provided uuid option", async () => {
    const fixedUuid = "6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b";
    const response = handleDevToolsRequest({
      projectRoot: "/test/project",
      uuid: fixedUuid,
    });
    const json = (await response.json()) as DevToolsJSON;
    assert.strictEqual(json.workspace.uuid, fixedUuid);
  });

  test("caches uuid across calls", async () => {
    setDevToolsUuid("cached-uuid-1234");
    const response1 = handleDevToolsRequest({ projectRoot: "/test" });
    const response2 = handleDevToolsRequest({ projectRoot: "/test" });
    const json1 = (await response1.json()) as DevToolsJSON;
    const json2 = (await response2.json()) as DevToolsJSON;
    assert.strictEqual(json1.workspace.uuid, json2.workspace.uuid);
  });
});
