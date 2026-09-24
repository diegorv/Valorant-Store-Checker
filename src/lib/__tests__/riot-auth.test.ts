import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// ---------------------------------------------------------------------------
// Constants (matching riot-tokens.ts)
// ---------------------------------------------------------------------------
const RIOT_AUTH_URL = "https://auth.riotgames.com/api/v1/authorization";
const RIOT_ENTITLEMENTS_URL = "https://entitlements.auth.riotgames.com/api/token/v1";
const RIOT_USERINFO_URL = "https://auth.riotgames.com/userinfo";
const RIOT_AUTHORIZE_URL = "https://auth.riotgames.com/authorize";

// ---------------------------------------------------------------------------
// Default MSW handlers (success path)
// ---------------------------------------------------------------------------

const handlers = [
  // Step 1: POST /api/v1/authorization — init session
  http.post(RIOT_AUTH_URL, () => {
    return new HttpResponse(
      JSON.stringify({ type: "auth" }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "asid=init-session-id; Path=/; HttpOnly",
        },
      },
    );
  }),

  // Step 2: PUT /api/v1/authorization — submit credentials (default: success)
  http.put(RIOT_AUTH_URL, () => {
    return new HttpResponse(
      JSON.stringify({
        type: "response",
        response: {
          parameters: {
            uri: "https://playvalorant.com/opt_in#access_token=test-access-token&id_token=test-id-token&token_type=Bearer",
          },
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "ssid=original-long-lived-ssid; Path=/; HttpOnly",
        },
      },
    );
  }),

  // Step 3: POST entitlements
  http.post(RIOT_ENTITLEMENTS_URL, () => {
    return HttpResponse.json({ entitlements_token: "test-entitlements-token" });
  }),

  // Step 4: GET userinfo
  http.get(RIOT_USERINFO_URL, () => {
    return HttpResponse.json({
      sub: "test-puuid",
      country: "US",
      email_verified: true,
      phone_number_verified: true,
      account_verified: true,
      age: 25,
      jti: "test-jti",
    });
  }),
];

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// authenticateRiotAccount tests
// ---------------------------------------------------------------------------

describe("authenticateRiotAccount", () => {
  it("success path: returns tokens with correct values", async () => {
    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.tokens.accessToken).toBe("test-access-token");
      expect(result.tokens.puuid).toBe("test-puuid");
      expect(result.tokens.entitlementsToken).toBe("test-entitlements-token");
      expect(result.tokens.region).toBe("na");
    }
  });

  it("MFA required: returns success=false with type='multifactor'", async () => {
    server.use(
      http.put(RIOT_AUTH_URL, () => {
        return HttpResponse.json({
          type: "multifactor",
          multifactor: { email: "u***@example.com", method: "email" },
        });
      }),
    );

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    // Unguarded on purpose: `if ("type" in result)` would pass even if the MFA
    // branch stopped returning anything.
    expect(result).toMatchObject({ success: false, type: "multifactor" });
  });

  it("auth error response: reports the reason Riot sent, not a generic message", async () => {
    server.use(
      http.put(RIOT_AUTH_URL, () => {
        return HttpResponse.json({
          type: "auth",
          error: "auth_failure",
          country: "usa",
        });
      }),
    );

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result).toMatchObject({
      success: false,
      error: "Riot Auth Error: auth_failure (Region: usa)",
    });
  });
});

// ---------------------------------------------------------------------------
// refreshTokensWithCookies tests
// ---------------------------------------------------------------------------

describe("refreshTokensWithCookies", () => {
  it("success path: SSID preserved (original ssid kept, not response ssid)", async () => {
    server.use(
      http.get(RIOT_AUTHORIZE_URL, () => {
        return new HttpResponse(null, {
          status: 303,
          headers: {
            Location:
              "https://playvalorant.com/opt_in#access_token=refreshed-token&id_token=refreshed-id-token&token_type=Bearer",
            "Set-Cookie": "ssid=new-session-ssid; Path=/",
          },
        });
      }),
      http.post(RIOT_ENTITLEMENTS_URL, () => {
        return HttpResponse.json({ entitlements_token: "refreshed-entitlements" });
      }),
      http.get(RIOT_USERINFO_URL, () => {
        return HttpResponse.json({
          sub: "test-puuid",
          country: "US",
          email_verified: true,
          phone_number_verified: true,
          account_verified: true,
          age: 25,
          jti: "test-jti",
        });
      }),
    );

    const { refreshTokensWithCookies } = await import("@/lib/riot-reauth");
    const result = await refreshTokensWithCookies(
      "ssid=original-long-lived-ssid; clid=test-clid",
    );

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.tokens.accessToken).toBe("refreshed-token");
      // The original ssid must be preserved — NOT "new-session-ssid"
      expect(result.riotCookies).toContain("original-long-lived-ssid");
      expect(result.riotCookies).not.toContain("new-session-ssid");
    }
  });

  it("expired session: GET /authorize redirects to login page → success=false", async () => {
    server.use(
      http.get(RIOT_AUTHORIZE_URL, () => {
        return new HttpResponse(null, {
          status: 303,
          headers: {
            Location: "https://authenticate.riotgames.com/login",
          },
        });
      }),
    );

    const { refreshTokensWithCookies } = await import("@/lib/riot-reauth");
    const result = await refreshTokensWithCookies("ssid=expired-ssid");

    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shared fixtures for the branch tests below
// ---------------------------------------------------------------------------

const VALID_URI =
  "https://playvalorant.com/opt_in#access_token=test-access-token&id_token=test-id-token&token_type=Bearer";

/** A Step 2 (PUT) response that succeeds and hands back `uri`. */
function putRespondingWithUri(uri: string | undefined, setCookie?: string) {
  return http.put(RIOT_AUTH_URL, () => {
    return new HttpResponse(
      JSON.stringify({
        type: "response",
        response: { parameters: uri === undefined ? {} : { uri } },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...(setCookie ? { "Set-Cookie": setCookie } : {}),
        },
      },
    );
  });
}

// ---------------------------------------------------------------------------
// getRiotLoginUrl
// ---------------------------------------------------------------------------

describe("getRiotLoginUrl", () => {
  it("builds an authorization URL carrying the Valorant client parameters", async () => {
    const { getRiotLoginUrl } = await import("@/lib/riot-auth");
    const url = new URL(getRiotLoginUrl());

    expect(url.origin + url.pathname).toBe(RIOT_AUTH_URL);
    expect(url.searchParams.get("client_id")).toBe("play-valorant-web-prod");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://playvalorant.com/opt_in",
    );
    expect(url.searchParams.get("response_type")).toBe("token id_token");
    expect(url.searchParams.get("scope")).toBeTruthy();
  });

  it("uses a fresh nonce on every call", async () => {
    const { getRiotLoginUrl } = await import("@/lib/riot-auth");
    const first = new URL(getRiotLoginUrl()).searchParams.get("nonce");
    const second = new URL(getRiotLoginUrl()).searchParams.get("nonce");

    expect(first).toBeTruthy();
    // 16 bytes of hex — a fixed or empty nonce would let a login URL be replayed.
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
  });
});

// ---------------------------------------------------------------------------
// completeAuthWithUrl
// ---------------------------------------------------------------------------

describe("completeAuthWithUrl", () => {
  it("extracts tokens from a full redirect URL", async () => {
    const { completeAuthWithUrl } = await import("@/lib/riot-auth");
    const result = await completeAuthWithUrl(VALID_URI);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.tokens.accessToken).toBe("test-access-token");
      expect(result.tokens.idToken).toBe("test-id-token");
      expect(result.tokens.entitlementsToken).toBe("test-entitlements-token");
      expect(result.tokens.puuid).toBe("test-puuid");
      expect(result.tokens.region).toBe("na");
    }
  });

  it("accepts a bare fragment with no leading '#'", async () => {
    const { completeAuthWithUrl } = await import("@/lib/riot-auth");
    const result = await completeAuthWithUrl(
      "access_token=test-access-token&id_token=test-id-token",
    );

    expect(result.success).toBe(true);
  });

  it("carries the account name, tag and country through from userinfo", async () => {
    server.use(
      http.get(RIOT_USERINFO_URL, () =>
        HttpResponse.json({
          sub: "test-puuid",
          country: "DE",
          acct: { game_name: "Player", tag_line: "0001" },
        }),
      ),
    );

    const { completeAuthWithUrl } = await import("@/lib/riot-auth");
    const result = await completeAuthWithUrl(VALID_URI);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.tokens.gameName).toBe("Player");
      expect(result.tokens.tagLine).toBe("0001");
      expect(result.tokens.country).toBe("DE");
      expect(result.tokens.region).toBe("eu");
    }
  });

  it("leaves the optional identity fields undefined when Riot omits them", async () => {
    server.use(
      http.get(RIOT_USERINFO_URL, () => HttpResponse.json({ sub: "test-puuid" })),
    );

    const { completeAuthWithUrl } = await import("@/lib/riot-auth");
    const result = await completeAuthWithUrl(VALID_URI);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.tokens.gameName).toBeUndefined();
      expect(result.tokens.tagLine).toBeUndefined();
      expect(result.tokens.country).toBeUndefined();
    }
  });

  it("rejects a URL with no access_token", async () => {
    const { completeAuthWithUrl } = await import("@/lib/riot-auth");
    const result = await completeAuthWithUrl(
      "https://playvalorant.com/opt_in#id_token=test-id-token",
    );

    expect(result).toEqual({
      success: false,
      error: "Invalid URL: Missing access_token or id_token",
    });
  });

  it("rejects a URL with no id_token", async () => {
    const { completeAuthWithUrl } = await import("@/lib/riot-auth");
    const result = await completeAuthWithUrl(
      "https://playvalorant.com/opt_in#access_token=test-access-token",
    );

    expect(result).toEqual({
      success: false,
      error: "Invalid URL: Missing access_token or id_token",
    });
  });

  it("reports an entitlements failure rather than returning a half-built session", async () => {
    server.use(
      http.post(
        RIOT_ENTITLEMENTS_URL,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );

    const { completeAuthWithUrl } = await import("@/lib/riot-auth");
    const result = await completeAuthWithUrl(VALID_URI);

    expect(result).toEqual({
      success: false,
      error: "Failed to retrieve entitlements token",
    });
  });

  it("reports a userinfo failure rather than returning a session with no puuid", async () => {
    server.use(
      http.get(RIOT_USERINFO_URL, () => new HttpResponse(null, { status: 401 })),
    );

    const { completeAuthWithUrl } = await import("@/lib/riot-auth");
    const result = await completeAuthWithUrl(VALID_URI);

    expect(result).toEqual({
      success: false,
      error: "Failed to retrieve user information",
    });
  });
});

// ---------------------------------------------------------------------------
// authenticateRiotAccount — failure branches
// ---------------------------------------------------------------------------

describe("authenticateRiotAccount — failure branches", () => {
  it("stops when the init request fails", async () => {
    server.use(
      http.post(
        RIOT_AUTH_URL,
        () =>
          new HttpResponse(null, {
            status: 503,
            statusText: "Service Unavailable",
          }),
      ),
    );

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result).toMatchObject({
      success: false,
      error: "Failed to initialize auth session: Service Unavailable",
    });
  });

  it("stops when init succeeds but sets no cookie", async () => {
    server.use(http.post(RIOT_AUTH_URL, () => HttpResponse.json({ type: "auth" })));

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result).toMatchObject({
      success: false,
      error: "No session cookie received from auth initialization",
    });
  });

  it("reports the status when the credential request is rejected", async () => {
    server.use(
      http.put(
        RIOT_AUTH_URL,
        () => new HttpResponse("nope", { status: 401, statusText: "Unauthorized" }),
      ),
    );

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result).toMatchObject({
      success: false,
      error: "Authentication failed: 401 Unauthorized",
    });
  });

  it("rejects a credential response that does not match the schema", async () => {
    server.use(http.put(RIOT_AUTH_URL, () => HttpResponse.json({ unexpected: true })));

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result).toMatchObject({
      success: false,
      error: "Invalid auth response from Riot",
    });
  });

  it("stops when Riot reports success but sends no redirect URI", async () => {
    server.use(putRespondingWithUri(undefined));

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result).toMatchObject({
      success: false,
      error: "No redirect URI received in response",
    });
  });

  it("stops when the redirect URI carries no tokens", async () => {
    server.use(putRespondingWithUri("https://playvalorant.com/opt_in#state=x"));

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result).toMatchObject({
      success: false,
      error: "Failed to extract tokens from redirect URI",
    });
  });

  it("stops when the entitlements request fails", async () => {
    server.use(
      http.post(
        RIOT_ENTITLEMENTS_URL,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result).toMatchObject({
      success: false,
      error: "Failed to retrieve entitlements token",
    });
  });

  it("stops when the userinfo request fails", async () => {
    server.use(
      http.get(RIOT_USERINFO_URL, () => new HttpResponse(null, { status: 401 })),
    );

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result).toMatchObject({
      success: false,
      error: "Failed to retrieve user information",
    });
  });

  it("omits the region suffix when Riot reports an error without a country", async () => {
    server.use(
      http.put(RIOT_AUTH_URL, () =>
        HttpResponse.json({ type: "auth", error: "auth_failure" }),
      ),
    );

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result).toMatchObject({
      success: false,
      error: "Riot Auth Error: auth_failure",
    });
  });

  it("falls back to a generic message when Riot reports a failure with no error field", async () => {
    server.use(http.put(RIOT_AUTH_URL, () => HttpResponse.json({ type: "auth" })));

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result).toMatchObject({
      success: false,
      error: "Riot Auth Error: Unknown authentication error",
    });
  });
});

// ---------------------------------------------------------------------------
// authenticateRiotAccount — what the success path returns
// ---------------------------------------------------------------------------

describe("authenticateRiotAccount — success payload", () => {
  it("returns the merged cookie jar from both authorization steps", async () => {
    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result.success).toBe(true);
    if (result.success) {
      // Step 1 sets asid, step 2 sets ssid — losing either breaks SSID re-auth.
      expect(result.riotCookies).toContain("asid=init-session-id");
      expect(result.riotCookies).toContain("ssid=original-long-lived-ssid");
    }
  });

  it("breaks the cookie jar out into the named cookies used for re-auth", async () => {
    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.namedCookies.ssid).toBe("original-long-lived-ssid");
    }
  });

  it("carries the account name, tag and country through from userinfo", async () => {
    server.use(
      http.get(RIOT_USERINFO_URL, () =>
        HttpResponse.json({
          sub: "test-puuid",
          country: "BR",
          acct: { game_name: "Jogador", tag_line: "BR1" },
        }),
      ),
    );

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.tokens.gameName).toBe("Jogador");
      expect(result.tokens.tagLine).toBe("BR1");
      expect(result.tokens.country).toBe("BR");
      expect(result.tokens.region).toBe("br");
    }
  });

  it("hands back the session cookie alongside the MFA challenge", async () => {
    server.use(
      http.put(
        RIOT_AUTH_URL,
        () =>
          new HttpResponse(
            JSON.stringify({
              type: "multifactor",
              multifactor: { email: "u***@example.com", method: "email" },
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Set-Cookie": "ssid=mfa-stage-ssid; Path=/",
              },
            },
          ),
      ),
    );

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    // Asserted unguarded: wrapping these in `if ("cookie" in result)` would let
    // the whole MFA branch disappear without the test noticing.
    expect(result).toMatchObject({
      success: false,
      type: "multifactor",
      multifactor: { method: "email" },
    });
    // Without this cookie submitMfa has no session to continue.
    expect((result as { cookie: string }).cookie).toContain("asid=init-session-id");
    expect((result as { cookie: string }).cookie).toContain("ssid=mfa-stage-ssid");
  });
});

// ---------------------------------------------------------------------------
// submitMfa
// ---------------------------------------------------------------------------

describe("submitMfa", () => {
  it("returns tokens when Riot accepts the code", async () => {
    server.use(putRespondingWithUri(VALID_URI, "ssid=post-mfa-ssid; Path=/"));

    const { submitMfa } = await import("@/lib/riot-auth");
    const result = await submitMfa("123456", "asid=mfa-session");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.tokens.accessToken).toBe("test-access-token");
      expect(result.tokens.puuid).toBe("test-puuid");
      expect(result.tokens.entitlementsToken).toBe("test-entitlements-token");
      // The incoming cookie must survive alongside whatever the MFA step set.
      expect(result.riotCookies).toContain("asid=mfa-session");
      expect(result.riotCookies).toContain("ssid=post-mfa-ssid");
      expect(result.namedCookies.ssid).toBe("post-mfa-ssid");
    }
  });

  it("reports the status when Riot rejects the code", async () => {
    server.use(
      http.put(
        RIOT_AUTH_URL,
        () => new HttpResponse(null, { status: 400, statusText: "Bad Request" }),
      ),
    );

    const { submitMfa } = await import("@/lib/riot-auth");
    const result = await submitMfa("000000", "asid=mfa-session");

    expect(result).toEqual({
      success: false,
      error: "MFA submission failed: Bad Request",
    });
  });

  it("reports the reason Riot sent when it rejects the code over HTTP 200", async () => {
    server.use(
      http.put(RIOT_AUTH_URL, () =>
        HttpResponse.json({ type: "auth", error: "auth_failure", country: "usa" }),
      ),
    );

    const { submitMfa } = await import("@/lib/riot-auth");
    const result = await submitMfa("000000", "asid=mfa-session");

    expect(result).toEqual({
      success: false,
      error: "Riot Auth Error: auth_failure (Region: usa)",
    });
  });

  it("falls back to a generic reason when the rejection carries no error text", async () => {
    server.use(http.put(RIOT_AUTH_URL, () => HttpResponse.json({ type: "auth" })));

    const { submitMfa } = await import("@/lib/riot-auth");
    const result = await submitMfa("000000", "asid=mfa-session");

    expect(result).toEqual({
      success: false,
      error: "Riot Auth Error: Unknown authentication error",
    });
  });

  it("hands back a re-issued multifactor challenge instead of a missing URI", async () => {
    server.use(
      http.put(
        RIOT_AUTH_URL,
        () =>
          new HttpResponse(
            JSON.stringify({
              type: "multifactor",
              multifactor: { email: "u***@example.com", method: "email" },
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Set-Cookie": "ssid=re-issued-ssid; Path=/",
              },
            },
          ),
      ),
    );

    const { submitMfa } = await import("@/lib/riot-auth");
    const result = await submitMfa("123456", "asid=mfa-session");

    // Asserted unguarded for the same reason as the credential path above: a
    // `if ("type" in result)` guard would pass with the branch deleted.
    expect(result).toMatchObject({
      success: false,
      type: "multifactor",
      multifactor: { method: "email" },
    });
    // Without this cookie the caller cannot submit the next code.
    expect((result as { cookie: string }).cookie).toContain("asid=mfa-session");
    expect((result as { cookie: string }).cookie).toContain("ssid=re-issued-ssid");
    // Riot said nothing about a failure, so no reason may be invented.
    expect((result as { error?: string }).error).toBeUndefined();
  });

  it("keeps the reason when the re-issued challenge says why the code failed", async () => {
    server.use(
      http.put(RIOT_AUTH_URL, () =>
        HttpResponse.json({
          type: "multifactor",
          error: "multifactor_attempt_failed",
          country: "usa",
          multifactor: { email: "u***@example.com", method: "email" },
        }),
      ),
    );

    const { submitMfa } = await import("@/lib/riot-auth");
    const result = await submitMfa("000000", "asid=mfa-session");

    // The shape that decides both new branches: still a challenge to re-prompt
    // with, but carrying the text that says the last code was refused.
    expect(result).toMatchObject({
      success: false,
      type: "multifactor",
      error: "Riot Auth Error: multifactor_attempt_failed (Region: usa)",
    });
  });

  it("rejects an MFA response that does not match the schema", async () => {
    server.use(http.put(RIOT_AUTH_URL, () => HttpResponse.json({ unexpected: true })));

    const { submitMfa } = await import("@/lib/riot-auth");
    const result = await submitMfa("123456", "asid=mfa-session");

    expect(result).toEqual({
      success: false,
      error: "Invalid MFA response from Riot",
    });
  });

  it("stops when the MFA response carries no redirect URI", async () => {
    server.use(putRespondingWithUri(undefined));

    const { submitMfa } = await import("@/lib/riot-auth");
    const result = await submitMfa("123456", "asid=mfa-session");

    expect(result).toEqual({
      success: false,
      error: "No redirect URI received after MFA",
    });
  });

  it("stops when the redirect URI carries no tokens", async () => {
    server.use(putRespondingWithUri("https://playvalorant.com/opt_in#state=x"));

    const { submitMfa } = await import("@/lib/riot-auth");
    const result = await submitMfa("123456", "asid=mfa-session");

    expect(result).toEqual({
      success: false,
      error: "Failed to extract tokens from redirect URI",
    });
  });

  it("stops when the entitlements request fails", async () => {
    server.use(
      putRespondingWithUri(VALID_URI),
      http.post(
        RIOT_ENTITLEMENTS_URL,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );

    const { submitMfa } = await import("@/lib/riot-auth");
    const result = await submitMfa("123456", "asid=mfa-session");

    expect(result).toEqual({
      success: false,
      error: "Failed to retrieve entitlements token",
    });
  });

  it("stops when the userinfo request fails", async () => {
    server.use(
      putRespondingWithUri(VALID_URI),
      http.get(RIOT_USERINFO_URL, () => new HttpResponse(null, { status: 401 })),
    );

    const { submitMfa } = await import("@/lib/riot-auth");
    const result = await submitMfa("123456", "asid=mfa-session");

    expect(result).toEqual({
      success: false,
      error: "Failed to retrieve user information",
    });
  });
});

// ---------------------------------------------------------------------------
// What we send to Riot
//
// Everything above asserts how responses are handled. These assert the request
// payloads: a wrong client_id, grant type or missing credential field is a bug
// Riot would reject in production and no response-shaped test would notice.
// ---------------------------------------------------------------------------

describe("outgoing requests", () => {
  it("initializes the session with the Valorant client parameters", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(RIOT_AUTH_URL, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return new HttpResponse(JSON.stringify({ type: "auth" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": "asid=init-session-id; Path=/",
          },
        });
      }),
    );

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    await authenticateRiotAccount("user", "pass");

    expect(body).toMatchObject({
      acr_values: "",
      client_id: "play-valorant-web-prod",
      redirect_uri: "https://playvalorant.com/opt_in",
      response_type: "token id_token",
    });
    expect(body!.scope).toBeTruthy();
    expect(body!.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("submits the credentials it was given, asking Riot to remember the device", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.put(RIOT_AUTH_URL, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          type: "response",
          response: { parameters: { uri: VALID_URI } },
        });
      }),
    );

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    await authenticateRiotAccount("someone", "s3cret");

    expect(body).toEqual({
      type: "auth",
      username: "someone",
      password: "s3cret",
      language: "en_US",
      region: null,
      remember: true,
    });
  });

  it("passes every init cookie along when submitting credentials", async () => {
    let cookie: string | null = null;
    server.use(
      // Riot sets several cookies on step 1; all of them have to be forwarded,
      // joined into one header rather than concatenated together.
      http.post(RIOT_AUTH_URL, () => {
        const headers = new Headers({ "Content-Type": "application/json" });
        headers.append("Set-Cookie", "asid=init-session-id; Path=/; HttpOnly");
        headers.append("Set-Cookie", "clid=init-clid; Path=/");
        return new HttpResponse(JSON.stringify({ type: "auth" }), {
          status: 200,
          headers,
        });
      }),
      http.put(RIOT_AUTH_URL, ({ request }) => {
        cookie = request.headers.get("Cookie");
        return HttpResponse.json({
          type: "response",
          response: { parameters: { uri: VALID_URI } },
        });
      }),
    );

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    await authenticateRiotAccount("user", "pass");

    // Step 2 without the step 1 session cookies is rejected by Riot. Asserted as
    // a substring because MSW re-attaches cookies it saw on earlier responses.
    expect(cookie).toContain("asid=init-session-id; clid=init-clid");
  });

  it("submits the MFA code with the caller's session cookie", async () => {
    let body: Record<string, unknown> | undefined;
    let cookie: string | null = null;
    server.use(
      http.put(RIOT_AUTH_URL, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        cookie = request.headers.get("Cookie");
        return HttpResponse.json({
          type: "response",
          response: { parameters: { uri: VALID_URI } },
        });
      }),
    );

    const { submitMfa } = await import("@/lib/riot-auth");
    await submitMfa("654321", "asid=mfa-session");

    expect(body).toEqual({
      type: "multifactor",
      code: "654321",
      rememberDevice: true,
    });
    expect(cookie).toContain("asid=mfa-session");
  });
});

// ---------------------------------------------------------------------------
// Malformed success responses
//
// Riot answering `type: "response"` with nothing under `response` must produce
// an error, not a TypeError from walking into undefined.
// ---------------------------------------------------------------------------

describe("responses missing the parameters object", () => {
  it("authenticateRiotAccount reports a missing redirect URI when response is absent", async () => {
    server.use(http.put(RIOT_AUTH_URL, () => HttpResponse.json({ type: "response" })));

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result).toMatchObject({
      success: false,
      error: "No redirect URI received in response",
    });
  });

  it("authenticateRiotAccount reports a missing redirect URI when parameters is absent", async () => {
    server.use(
      http.put(RIOT_AUTH_URL, () => HttpResponse.json({ type: "response", response: {} })),
    );

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result).toMatchObject({
      success: false,
      error: "No redirect URI received in response",
    });
  });

  it("submitMfa reports a missing redirect URI when response is absent", async () => {
    server.use(http.put(RIOT_AUTH_URL, () => HttpResponse.json({ type: "response" })));

    const { submitMfa } = await import("@/lib/riot-auth");
    const result = await submitMfa("123456", "asid=mfa-session");

    expect(result).toEqual({
      success: false,
      error: "No redirect URI received after MFA",
    });
  });

  it("submitMfa reports a missing redirect URI when parameters is absent", async () => {
    server.use(
      http.put(RIOT_AUTH_URL, () => HttpResponse.json({ type: "response", response: {} })),
    );

    const { submitMfa } = await import("@/lib/riot-auth");
    const result = await submitMfa("123456", "asid=mfa-session");

    expect(result).toEqual({
      success: false,
      error: "No redirect URI received after MFA",
    });
  });
});

// ---------------------------------------------------------------------------
// submitMfa identity fields
// ---------------------------------------------------------------------------

describe("submitMfa — identity fields", () => {
  it("carries the account name, tag and country through from userinfo", async () => {
    server.use(
      putRespondingWithUri(VALID_URI),
      http.get(RIOT_USERINFO_URL, () =>
        HttpResponse.json({
          sub: "test-puuid",
          country: "KR",
          acct: { game_name: "선수", tag_line: "KR1" },
        }),
      ),
    );

    const { submitMfa } = await import("@/lib/riot-auth");
    const result = await submitMfa("123456", "asid=mfa-session");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.tokens.gameName).toBe("선수");
      expect(result.tokens.tagLine).toBe("KR1");
      expect(result.tokens.country).toBe("KR");
      expect(result.tokens.region).toBe("kr");
      expect(result.tokens.idToken).toBe("test-id-token");
    }
  });

  it("leaves the optional identity fields undefined when Riot omits them", async () => {
    server.use(
      putRespondingWithUri(VALID_URI),
      http.get(RIOT_USERINFO_URL, () => HttpResponse.json({ sub: "test-puuid" })),
    );

    const { submitMfa } = await import("@/lib/riot-auth");
    const result = await submitMfa("123456", "asid=mfa-session");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.tokens.gameName).toBeUndefined();
      expect(result.tokens.tagLine).toBeUndefined();
      expect(result.tokens.country).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// authenticateRiotAccount — what reaches the logs
// ---------------------------------------------------------------------------

const LEAKED_ACCESS_TOKEN = "eyJhbGciOiJSUzI1NiJ9.bGl2ZS1hY2Nlc3M.signature-aaa";
const LEAKED_ID_TOKEN = "eyJhbGciOiJSUzI1NiJ9.bGl2ZS1pZA.signature-bbb";
const TOKEN_BEARING_URI =
  `https://playvalorant.com/opt_in#access_token=${LEAKED_ACCESS_TOKEN}` +
  `&id_token=${LEAKED_ID_TOKEN}&token_type=Bearer&expires_in=3600`;

describe("authenticateRiotAccount — logging", () => {
  let emitted: string[] = [];
  let emittedDebug: string[] = [];

  beforeEach(() => {
    emitted = [];
    emittedDebug = [];
    const format = (args: unknown[]) =>
      args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    const capture = (...args: unknown[]) => {
      emitted.push(format(args));
    };
    // logger.ts reads LOG_LEVEL at createLogger() time, so pin it before
    // riot-auth builds its module-scope logger: debug stays on here whatever
    // the runner's environment sets.
    vi.stubEnv("LOG_LEVEL", "debug");
    vi.resetModules();
    vi.spyOn(console, "debug").mockImplementation((...args: unknown[]) => {
      emittedDebug.push(format(args));
      capture(...args);
    });
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "warn").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("never writes the Riot tokens to the log on a successful login", async () => {
    server.use(putRespondingWithUri(TOKEN_BEARING_URI, "ssid=original-long-lived-ssid; Path=/"));

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result.success).toBe(true);
    // Asserted so the test cannot pass just because debug logging is off.
    expect(emittedDebug.some((line) => line.startsWith("[riot-auth]"))).toBe(true);
    expect(emitted.join("\n")).not.toContain(LEAKED_ACCESS_TOKEN);
    expect(emitted.join("\n")).not.toContain(LEAKED_ID_TOKEN);
  });

  it("logs a bounded slice of the upstream body when the credential request fails upstream", async () => {
    server.use(
      http.put(
        RIOT_AUTH_URL,
        () =>
          new HttpResponse("E".repeat(5000), {
            status: 401,
            statusText: "Unauthorized",
          }),
      ),
    );

    const { authenticateRiotAccount } = await import("@/lib/riot-auth");
    const result = await authenticateRiotAccount("user", "pass");

    expect(result.success).toBe(false);
    const logged = emitted.find((line) => line.includes("Step 2 - Error body:"));
    expect(logged).toBeDefined();
    // Enough text to identify the failure...
    expect(logged).toContain("E".repeat(200));
    // ...but not an unbounded third-party string.
    expect(logged).not.toContain("E".repeat(201));
  });
});
