import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — all declared before any imports (vi.mock is hoisted)
// ---------------------------------------------------------------------------

// Both the boot guard and every rateLimit() call read this export, so the tests
// swap its value instead of reloading the module.
const redisStub = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/redis-client", () => ({
  get redis() {
    return redisStub.value;
  },
}));

const limitMock = vi.hoisted(() => vi.fn());
const ratelimitConfig = vi.hoisted(() => ({
  value: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow = vi.fn(() => ({}));
    limit = limitMock;
    constructor(config: Record<string, unknown>) {
      ratelimitConfig.value = config;
    }
  },
}));

// Import AFTER the mock declarations (vi.mock is hoisted, so this is safe).
const { rateLimit } = await import("@/lib/rate-limiter");
const { register } = await import("@/instrumentation");

const originalNodeEnv = process.env.NODE_ENV;

/** NODE_ENV is typed readonly and as a closed union — tests need the raw bag */
function setEnv(key: string, value: string | undefined): void {
  const bag = process.env as Record<string, string | undefined>;
  if (value === undefined) {
    delete bag[key];
  } else {
    bag[key] = value;
  }
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  limitMock.mockReset();
  ratelimitConfig.value = undefined;
  redisStub.value = null;
  global.__authRatelimit = undefined;
});

afterEach(() => {
  warnSpy.mockRestore();
  setEnv("NODE_ENV", originalNodeEnv);
  global.__authRatelimit = undefined;
});

// ---------------------------------------------------------------------------
// (a) Redis was never configured — the deployment must not come up
// ---------------------------------------------------------------------------

describe("instrumentation register() with no Redis client", () => {
  it("refuses to start in an environment that is neither development nor test", async () => {
    redisStub.value = null;
    setEnv("NODE_ENV", "staging");

    await expect(register()).rejects.toThrow(/UPSTASH_REDIS_REST_URL/);
  });

  it("refuses to start when NODE_ENV is unset", async () => {
    redisStub.value = null;
    setEnv("NODE_ENV", undefined);

    await expect(register()).rejects.toThrow(/UPSTASH_REDIS_REST_URL/);
  });

  it("starts once Redis is configured", async () => {
    // Which credentials produce a client — including the KV_REST_API_* pair the
    // Vercel Marketplace injects — is redis-client.test.ts's job.
    redisStub.value = { configured: true };
    setEnv("NODE_ENV", "staging");

    await expect(register()).resolves.toBeUndefined();
  });

  it("still starts without Redis in development", async () => {
    redisStub.value = null;
    setEnv("NODE_ENV", "development");

    await expect(register()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The two fail-open paths must be distinct, and both must be loud
// ---------------------------------------------------------------------------

describe("rateLimit() when Redis was never configured", () => {
  it("warns on every request it lets through, not once at boot", async () => {
    redisStub.value = null;

    await rateLimit("1.2.3.4");
    await rateLimit("1.2.3.4");

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0].join(" ")).toMatch(/not configured/i);
    expect(limitMock).not.toHaveBeenCalled();
  });
});

describe("rateLimit() when Redis is configured but unreachable", () => {
  it("warns on every request the timeout lets through, and still lets it through", async () => {
    redisStub.value = { configured: true };
    limitMock.mockResolvedValue({
      success: true,
      limit: 0,
      remaining: 0,
      reset: 0,
      pending: Promise.resolve(),
      reason: "timeout",
    });

    expect((await rateLimit("1.2.3.4")).success).toBe(true);
    expect((await rateLimit("1.2.3.4")).success).toBe(true);

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0].join(" ")).toMatch(/unreachable/i);
    // Without this option @upstash/ratelimit never reports reason "timeout",
    // and this whole case collapses into the never-configured one.
    expect(ratelimitConfig.value).toMatchObject({ timeout: 5000 });
  });

  it("stays silent when Redis answers", async () => {
    redisStub.value = { configured: true };
    limitMock.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: 0,
      pending: Promise.resolve(),
    });

    expect((await rateLimit("1.2.3.4")).remaining).toBe(9);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
