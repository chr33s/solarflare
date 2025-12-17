import { describe, it, expect } from "bun:test";
import { serializeToString, parseFromString } from "./serialize";

describe("serializeToString", () => {
  it("should serialize primitive string", async () => {
    const result = await serializeToString("hello");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("should serialize primitive number", async () => {
    const result = await serializeToString(42);
    expect(typeof result).toBe("string");
  });

  it("should serialize primitive boolean", async () => {
    const result = await serializeToString(true);
    expect(typeof result).toBe("string");
  });

  it("should serialize null", async () => {
    const result = await serializeToString(null);
    expect(typeof result).toBe("string");
  });

  it("should serialize undefined", async () => {
    const result = await serializeToString(undefined);
    expect(typeof result).toBe("string");
  });

  it("should serialize arrays", async () => {
    const result = await serializeToString([1, 2, 3]);
    expect(typeof result).toBe("string");
  });

  it("should serialize objects", async () => {
    const result = await serializeToString({ a: 1, b: "two" });
    expect(typeof result).toBe("string");
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
    expect(typeof result).toBe("string");
  });

  it("should serialize Date objects", async () => {
    const date = new Date("2024-01-01T00:00:00Z");
    const result = await serializeToString(date);
    expect(typeof result).toBe("string");
  });

  it("should serialize Map objects", async () => {
    const map = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    const result = await serializeToString(map);
    expect(typeof result).toBe("string");
  });

  it("should serialize Set objects", async () => {
    const set = new Set([1, 2, 3]);
    const result = await serializeToString(set);
    expect(typeof result).toBe("string");
  });
});

describe("parseFromString", () => {
  it("should parse serialized string", async () => {
    const original = "hello world";
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<string>(serialized);
    expect(parsed).toBe(original);
  });

  it("should parse serialized number", async () => {
    const original = 12345;
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<number>(serialized);
    expect(parsed).toBe(original);
  });

  it("should parse serialized boolean", async () => {
    const serialized = await serializeToString(true);
    const parsed = await parseFromString<boolean>(serialized);
    expect(parsed).toBe(true);
  });

  it("should parse serialized null", async () => {
    const serialized = await serializeToString(null);
    const parsed = await parseFromString<null>(serialized);
    expect(parsed).toBe(null);
  });

  it("should parse serialized array", async () => {
    const original = [1, "two", true, null];
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<typeof original>(serialized);
    expect(parsed).toEqual(original);
  });

  it("should parse serialized object", async () => {
    const original = { name: "Test", count: 42, active: true };
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<typeof original>(serialized);
    expect(parsed).toEqual(original);
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
    expect(parsed).toEqual(original);
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
    expect(parsed).toEqual(original);
  });
});

describe("roundtrip", () => {
  it("should roundtrip empty string", async () => {
    const original = "";
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<string>(serialized);
    expect(parsed).toBe(original);
  });

  it("should roundtrip zero", async () => {
    const original = 0;
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<number>(serialized);
    expect(parsed).toBe(original);
  });

  it("should roundtrip empty object", async () => {
    const original = {};
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<object>(serialized);
    expect(parsed).toEqual(original);
  });

  it("should roundtrip empty array", async () => {
    const original: unknown[] = [];
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<unknown[]>(serialized);
    expect(parsed).toEqual(original);
  });

  it("should roundtrip special characters", async () => {
    const original = { text: "Hello <script>alert('xss')</script> & \"quotes\"" };
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<typeof original>(serialized);
    expect(parsed).toEqual(original);
  });

  it("should roundtrip unicode characters", async () => {
    const original = { emoji: "🚀🌟💻", chinese: "你好", arabic: "مرحبا" };
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<typeof original>(serialized);
    expect(parsed).toEqual(original);
  });

  it("should roundtrip Date objects", async () => {
    const original = new Date("2024-06-15T12:30:45.123Z");
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<Date>(serialized);
    expect(parsed).toEqual(original);
  });

  it("should roundtrip Map objects", async () => {
    const original = new Map<string, number>([
      ["one", 1],
      ["two", 2],
      ["three", 3],
    ]);
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<Map<string, number>>(serialized);
    expect(parsed).toEqual(original);
  });

  it("should roundtrip Set objects", async () => {
    const original = new Set(["a", "b", "c"]);
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<Set<string>>(serialized);
    expect(parsed).toEqual(original);
  });

  it("should roundtrip BigInt", async () => {
    const original = BigInt("9007199254740993");
    const serialized = await serializeToString(original);
    const parsed = await parseFromString<bigint>(serialized);
    expect(parsed).toBe(original);
  });
});
