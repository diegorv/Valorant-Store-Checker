import { describe, it, expect } from "vitest";
import { encrypt, decrypt, isEncrypted } from "@/lib/session-crypto";

const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);

// Flip the first hex digit of one colon-delimited segment.
function tamper(value: string, segment: 0 | 1 | 2): string {
  const parts = value.split(":");
  const s = parts[segment]!;
  parts[segment] = (s[0] === "0" ? "1" : "0") + s.slice(1);
  return parts.join(":");
}

describe("encrypt / decrypt", () => {
  it("round-trips a cookie string, including non-ASCII text", () => {
    const plaintext = "ssid=abc; tdid=xyz; name=Café ☕";
    expect(decrypt(encrypt(plaintext, KEY), KEY)).toBe(plaintext);
  });

  it("emits iv:authTag:ciphertext with a 12-byte IV and a 16-byte tag", () => {
    const [iv, tag, ct] = encrypt("hello", KEY).split(":");
    expect(iv).toMatch(/^[0-9a-f]{24}$/);
    expect(tag).toMatch(/^[0-9a-f]{32}$/);
    expect(ct).toMatch(/^[0-9a-f]{10}$/);
  });

  it("uses a fresh IV per call, so equal plaintexts encrypt differently", () => {
    const a = encrypt("same", KEY);
    const b = encrypt("same", KEY);
    expect(a.split(":")[0]).not.toBe(b.split(":")[0]);
    expect(a).not.toBe(b);
  });

  it("rejects a value decrypted with the wrong key", () => {
    expect(() => decrypt(encrypt("secret", KEY), OTHER_KEY)).toThrow();
  });

  it.each([
    ["IV", 0],
    ["auth tag", 1],
    ["ciphertext", 2],
  ] as const)("rejects a value whose %s was tampered with", (_label, segment) => {
    expect(() => decrypt(tamper(encrypt("secret", KEY), segment), KEY)).toThrow();
  });

  it.each([4, 12])("rejects a value whose auth tag was truncated to %i bytes", (bytes) => {
    const parts = encrypt("secret", KEY).split(":");
    parts[1] = parts[1]!.slice(0, bytes * 2);
    expect(() => decrypt(parts.join(":"), KEY)).toThrow();
  });

  it.each(["abc:def", "a:b:c:d", "no-colons"])(
    "rejects %s as not being iv:authTag:ciphertext",
    (value) => {
      expect(() => decrypt(value, KEY)).toThrow("Invalid encrypted value format");
    },
  );
});

describe("isEncrypted", () => {
  it("recognises the output of encrypt", () => {
    expect(isEncrypted(encrypt("ssid=abc", KEY))).toBe(true);
  });

  it("accepts upper-case hex", () => {
    expect(isEncrypted("ABCDEF:0123:9F")).toBe(true);
  });

  it.each([
    ["a plaintext cookie string", "ssid=abc; tdid=xyz"],
    ["two segments", "abcd:ef01"],
    ["four segments", "ab:cd:ef:01"],
    ["an empty segment", "ab::ef"],
    ["a non-hex character", "ab:cd:eg"],
    ["leading junk", "x ab:cd:ef"],
    ["trailing junk", "ab:cd:ef x"],
    ["the empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(isEncrypted(value)).toBe(false);
  });
});
