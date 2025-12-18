import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { serializeToString, parseFromString } from "./serialize.ts";

describe("serializeToString", () => {
  it("should serialize primitive string", async () => {
    const result = await serializeToString("hello");
    assert.strictEqual(typeof result, "string");
    assert.ok(result.length > 0);
  });

  it("should serialize primitive number", async () => {
    const result = await serializeToString(42);
    assert.strictEqual(typeof result, "string");
  });

  it("should serialize primitive boolean", async () => {
    const result = await serializeToString(true);
    assert.strictEqual(typeof result, "string");
  });

  it("should serialize null", async () => {
    const result = await serializeToString(null);
    assert.strictEqual(typeof result, "string");
  });

  it("should serialize undefined", async () => {
    const result = await serializeToString(undefined);
    assert.strictEqual(typeof result, "string");
  });

  it("should serialize arrays", async () => {
    const result = await serializeToString([1, 2, 3]);
    assert.strictEqual(typeof result, "string");
  });

  it("should serialize objects", async () => {
    const result = await serializeToString({ a: 1, b: "two" });
    assert.strictEqual(typeof result, "string");
  });

  it("should serialize nested objects", async () => {
    const data = {
      user: {
        name: "John",
        posts: [
          { id: 1, title: "Hello" },
          { id: 2, title: "World" },
        ],
      },
    };
    const result = await serializeToString(data);
    assert.strictEqual(typeof result, "string");
  });

  it("should serialize Date objects", async () => {
    const date = new Date("2024-01-01T00:00:00Z");
    const result = await serializeToString(date);
    assert.strictEqual(typeof result, "string");
  });

  it("should serialize Map objects", async () => {
    const map = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    const result = await serializeToString(map);
    assert.strictEqual(typeof result, "string");
  });

  it("should serialize Set objects", async () => {
    const set = new Set([1, 2, 3]);
    const result = await serializeToString(set);
    assert.strictEqual(typeof result, "string");
  });
});

describe("parseFromString", () => {
  it("should parse serialized string", async () => {
    const original = "hello world";
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<string>(serialized);
    assert.strictEqual(parsed, original);
  });

  it("should parse serialized number", async () => {
    const original = 12345;
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<number>(serialized);
    assert.strictEqual(parsed, original);
  });

  it("should parse serialized boolean", async () => {
    const serialized = await serializeToString(true);
    const parsed = await parseFromString<boolean>(serialized);
    assert.strictEqual(parsed, true);
  });

  it("should parse serialized null", async () => {
    const serialized = await serializeToString(null);
    const parsed = await parseFromString<null>(serialized);
    assert.strictEqual(parsed, null);
  });

  it("should parse serialized array", async () => {
    const original = [1, "two", true, null];
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<typeof original>(serialized);
    assert.deepStrictEqual(parsed, original);
  });

  it("should parse serialized object", async () => {
    const original = { name: "Test", count: 42, active: true };
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<typeof original>(serialized);
    assert.deepStrictEqual(parsed, original);
  });

  it("should parse nested objects", async () => {
    const original = {
      level1: {
        level2: {
          level3: { value: "deep" },
        },
      },
    };
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<typeof original>(serialized);
    assert.deepStrictEqual(parsed, original);
  });

  it("should parse complex data structures", async () => {
    const original = {
      users: [
        { id: 1, name: "Alice", roles: ["admin", "user"] },
        { id: 2, name: "Bob", roles: ["user"] },
      ],
      meta: {
        total: 2,
        page: 1,
        perPage: 10,
      },
    };
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<typeof original>(serialized);
    assert.deepStrictEqual(parsed, original);
  });
});

describe("roundtrip", () => {
  it("should roundtrip empty string", async () => {
    const original = "";
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<string>(serialized);
    assert.strictEqual(parsed, original);
  });

  it("should roundtrip zero", async () => {
    const original = 0;
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<number>(serialized);
    assert.strictEqual(parsed, original);
  });

  it("should roundtrip empty object", async () => {
    const original = {};
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<object>(serialized);
    assert.deepStrictEqual(parsed, original);
  });

  it("should roundtrip empty array", async () => {
    const original: unknown[] = [];
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<unknown[]>(serialized);
    assert.deepStrictEqual(parsed, original);
  });

  it("should roundtrip special characters", async () => {
    const original = { text: "Hello <script>alert('xss')</script> & \"quotes\"" };
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<typeof original>(serialized);
    assert.deepStrictEqual(parsed, original);
  });

  it("should roundtrip unicode characters", async () => {
    const original = { emoji: "🚀🌟💻", chinese: "你好", arabic: "مرحبا" };
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<typeof original>(serialized);
    assert.deepStrictEqual(parsed, original);
  });

  it("should roundtrip Date objects", async () => {
    const original = new Date("2024-06-15T12:30:45.123Z");
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<Date>(serialized);
    assert.deepStrictEqual(parsed, original);
  });

  it("should roundtrip Map objects", async () => {
    const original = new Map<string, number>([
      ["one", 1],
      ["two", 2],
      ["three", 3],
    ]);
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<Map<string, number>>(serialized);
    assert.deepStrictEqual(parsed, original);
  });

  it("should roundtrip Set objects", async () => {
    const original = new Set(["a", "b", "c"]);
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<Set<string>>(serialized);
    assert.deepStrictEqual(parsed, original);
  });

  it("should roundtrip BigInt", async () => {
    const original = BigInt("9007199254740993");
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<bigint>(serialized);
    assert.strictEqual(parsed, original);
  });
});
