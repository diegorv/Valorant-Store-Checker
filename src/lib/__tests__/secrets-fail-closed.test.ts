import { describe, it, expect, vi, afterEach } from "vitest";
import type { SessionData } from "@/lib/schemas/session";

// saveSessionToStore awaits initSessionDb before it reads the encryption key,
// so the DB needs a stub — the guard throws before anything is written.
vi.mock("@/lib/session-db", () => ({
  initSessionDb: vi.fn(async () => ({ execute: vi.fn() })),
}));

// The most hostile env module a test could write: a valid 64-hex key and
// NODE_ENV pinned to "test". The guards must ignore all of it and read the raw
// process environment, so this mock can never turn a fail-closed case green.
vi.mock("@/lib/env", () => ({
  env: { NODE_ENV: "test", ENCRYPTION_KEY: "0".repeat(64) },
}));

// Import AFTER the mock declarations (vi.mock is hoisted, so this is safe).
const { saveSessionToStore } = await import("@/lib/session-store");
const { register } = await import("@/instrumentation");

const originalNodeEnv = process.env.NODE_ENV;
const originalSessionSecret = process.env.SESSION_SECRET;
const originalEncryptionKey = process.env.ENCRYPTION_KEY;

/** NODE_ENV is typed readonly and as a closed union — tests need the raw bag */
function setEnv(key: string, value: string | undefined): void {
  const bag = process.env as Record<string, string | undefined>;
  if (value === undefined) {
    delete bag[key];
  } else {
    bag[key] = value;
  }
}

// "@/lib/env" is mocked above and in the global setup, so pull the real module
// with importActual and re-evaluate it per case.
async function loadEnv() {
  vi.resetModules();
  const mod = await vi.importActual<typeof import("@/lib/env")>("@/lib/env");
  return mod.env;
}

const sessionWithCookies: SessionData = {
  accessToken: "test-access-token",
  entitlementsToken: "test-entitlements-token",
  puuid: "test-puuid",
  region: "na",
  riotCookies: "ssid=test-cookie",
  createdAt: Date.now(),
};

afterEach(() => {
  setEnv("NODE_ENV", originalNodeEnv);
  setEnv("SESSION_SECRET", originalSessionSecret);
  setEnv("ENCRYPTION_KEY", originalEncryptionKey);
  vi.resetModules();
});

describe("SESSION_SECRET", () => {
  it("refuses to start in an environment that is neither development nor test", async () => {
    setEnv("SESSION_SECRET", undefined);
    setEnv("NODE_ENV", "staging");

    await expect(loadEnv()).rejects.toThrow(/Missing required environment variable: SESSION_SECRET/);
  });

  it("refuses to start when NODE_ENV is unset", async () => {
    setEnv("SESSION_SECRET", undefined);
    setEnv("NODE_ENV", undefined);

    await expect(loadEnv()).rejects.toThrow(/Missing required environment variable: SESSION_SECRET/);
  });

  it("still falls back to the insecure default in development", async () => {
    setEnv("SESSION_SECRET", undefined);
    setEnv("NODE_ENV", "development");

    expect((await loadEnv()).SESSION_SECRET).toBe("dev-only-insecure-secret");
  });

  it("still falls back to the insecure default in test", async () => {
    setEnv("SESSION_SECRET", undefined);
    setEnv("NODE_ENV", "test");

    expect((await loadEnv()).SESSION_SECRET).toBe("dev-only-insecure-secret");
  });
});

describe("instrumentation register()", () => {
  it("refuses to start without ENCRYPTION_KEY in an environment that is neither development nor test", async () => {
    setEnv("ENCRYPTION_KEY", undefined);
    setEnv("NODE_ENV", "staging");

    await expect(register()).rejects.toThrow(/ENCRYPTION_KEY environment variable is required/);
  });

  it("refuses to start without ENCRYPTION_KEY when NODE_ENV is unset", async () => {
    setEnv("ENCRYPTION_KEY", undefined);
    setEnv("NODE_ENV", undefined);

    await expect(register()).rejects.toThrow(/ENCRYPTION_KEY environment variable is required/);
  });

  it("stays silent without ENCRYPTION_KEY in development", async () => {
    setEnv("ENCRYPTION_KEY", undefined);
    setEnv("NODE_ENV", "development");

    await expect(register()).resolves.toBeUndefined();
  });
});

describe("session-store encryption key", () => {
  it("is not defeated by a mocked env module that supplies a key and pins NODE_ENV to test", async () => {
    setEnv("ENCRYPTION_KEY", undefined);
    setEnv("NODE_ENV", "staging");

    await expect(
      saveSessionToStore("11111111-1111-1111-1111-111111111111", sessionWithCookies, 3600),
    ).rejects.toThrow(/ENCRYPTION_KEY required/);
  });

  it("still falls back to the zero key in development", async () => {
    setEnv("ENCRYPTION_KEY", undefined);
    setEnv("NODE_ENV", "development");

    await expect(
      saveSessionToStore("11111111-1111-1111-1111-111111111111", sessionWithCookies, 3600),
    ).resolves.toBeUndefined();
  });
});
