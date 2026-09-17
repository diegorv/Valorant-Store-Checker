import { describe, it, expect, vi, afterEach } from "vitest";

// The global setup mocks "@/lib/env" for every other suite, so these tests pull
// the real module with importActual and re-evaluate it per case.
async function loadEnv(value?: string) {
  vi.resetModules();
  if (value === undefined) {
    delete process.env.TRUSTED_PROXY_HOPS;
  } else {
    process.env.TRUSTED_PROXY_HOPS = value;
  }
  const mod = await vi.importActual<typeof import("@/lib/env")>("@/lib/env");
  return mod.env;
}

describe("env.TRUSTED_PROXY_HOPS", () => {
  const original = process.env.TRUSTED_PROXY_HOPS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.TRUSTED_PROXY_HOPS;
    } else {
      process.env.TRUSTED_PROXY_HOPS = original;
    }
    vi.resetModules();
  });

  it("defaults to 1 when unset, so a lone proxy hop is trusted", async () => {
    expect((await loadEnv()).TRUSTED_PROXY_HOPS).toBe(1);
  });

  it("treats an empty value as unset", async () => {
    expect((await loadEnv("")).TRUSTED_PROXY_HOPS).toBe(1);
  });

  it("preserves an explicit 0 instead of reading it as unset", async () => {
    expect((await loadEnv("0")).TRUSTED_PROXY_HOPS).toBe(0);
  });

  it("reads a configured hop count", async () => {
    expect((await loadEnv("2")).TRUSTED_PROXY_HOPS).toBe(2);
  });

  it("falls back to the default when the value is not a number", async () => {
    expect((await loadEnv("banana")).TRUSTED_PROXY_HOPS).toBe(1);
  });

  it("clamps a negative value to 0", async () => {
    expect((await loadEnv("-3")).TRUSTED_PROXY_HOPS).toBe(0);
  });
});
