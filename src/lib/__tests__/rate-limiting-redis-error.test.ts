import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks — all declared before any imports (vi.mock is hoisted)
// ---------------------------------------------------------------------------

// Every rateLimit() call reads this export, so the tests swap its value
// instead of reloading the module.
const redisStub = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/redis-client", () => ({
  get redis() {
    return redisStub.value;
  },
}));

const limitMock = vi.hoisted(() => vi.fn());
const slidingWindowMock = vi.hoisted(() => vi.fn(() => ({})));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow = slidingWindowMock;
    limit = limitMock;
  },
}));

// The auth route's own dependencies. The rate limiter is the code under test
// here, so — unlike auth-route.test.ts — it is deliberately NOT mocked.
vi.mock("@/lib/riot-auth", () => ({
  authenticateRiotAccount: vi.fn(),
  submitMfa: vi.fn(),
  completeAuthWithUrl: vi.fn(),
}));

vi.mock("@/lib/accounts", () => ({
  addAccount: vi.fn().mockResolvedValue(undefined),
  migrateSessionToRegistry: vi.fn().mockResolvedValue(undefined),
}));

// Import AFTER the mock declarations (vi.mock is hoisted, so this is safe).
const { rateLimit } = await import("@/lib/rate-limiter");
const { POST } = await import("@/app/api/auth/route");
const { completeAuthWithUrl } = await import("@/lib/riot-auth");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * What @upstash/redis actually throws on the first non-ok HTTP response —
 * `${body.error}, command was: ${JSON.stringify(req.body)}`. HTTP errors are
 * not retried, so a rotated token rejects immediately, well inside the 5s
 * timeout that only fires for a genuine hang.
 */
function upstashError(): Error {
  const error = new Error(
    'WRONGPASS invalid or missing auth token, command was: ["EVALSHA","e17a8ef","1","@upstash/ratelimit:198.51.100.7"]',
  );
  error.name = "UpstashError";
  return error;
}

function makeUrlAuthRequest(): NextRequest {
  return new NextRequest("http://localhost/api/auth", {
    method: "POST",
    body: JSON.stringify({ type: "url", url: "https://playvalorant.com/#access_token=x" }),
    headers: { "Content-Type": "application/json" },
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  limitMock.mockReset();
  redisStub.value = { configured: true };
  global.__authRatelimit = undefined;

  vi.mocked(completeAuthWithUrl).mockResolvedValue({
    success: true,
    tokens: {
      accessToken: "access-tok",
      idToken: "id-tok",
      entitlementsToken: "ent-tok",
      puuid: "test-puuid-1234",
      region: "na",
    },
  });
});

afterEach(() => {
  errorSpy.mockRestore();
  global.__authRatelimit = undefined;
});

// ---------------------------------------------------------------------------
// The third fail-open path: Redis is configured, and it errored
// ---------------------------------------------------------------------------

describe("rateLimit() when Redis is configured but rejects", () => {
  it("serves the request instead of letting the rejection escape", async () => {
    limitMock.mockRejectedValue(upstashError());

    await expect(rateLimit("198.51.100.7")).resolves.toMatchObject({ success: true });
  });

  it("logs the server's reason on every request it lets through, never the command that carries the IP", async () => {
    limitMock.mockRejectedValue(upstashError());

    await rateLimit("198.51.100.7");
    await rateLimit("198.51.100.7");

    expect(errorSpy).toHaveBeenCalledTimes(2);
    const line = errorSpy.mock.calls[0].join(" ");
    expect(line).toMatch(/UpstashError/);
    expect(line).toMatch(/WRONGPASS invalid or missing auth token/);
    expect(line).not.toMatch(/198\.51\.100\.7/);
    expect(line).not.toMatch(/EVALSHA/);
  });

  it("drops the message entirely when it is not shaped like an @upstash/redis one", async () => {
    limitMock.mockRejectedValue(new TypeError("fetch failed"));

    await rateLimit("198.51.100.7");

    const line = errorSpy.mock.calls[0].join(" ");
    expect(line).toMatch(/TypeError/);
    expect(line).not.toMatch(/fetch failed/);
  });

  it("still lets a bug in the limiter's own construction escape", async () => {
    slidingWindowMock.mockImplementationOnce(() => {
      throw new TypeError("limiter misconfigured");
    });

    await expect(rateLimit("198.51.100.7")).rejects.toThrow("limiter misconfigured");
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth with a rejecting rate limiter", () => {
  it("still authenticates instead of returning a 500", async () => {
    limitMock.mockRejectedValue(upstashError());

    const res = await POST(makeUrlAuthRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
  });
});
