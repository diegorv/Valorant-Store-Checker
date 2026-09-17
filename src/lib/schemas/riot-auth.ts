import { z } from "zod";

export const EntitlementsResponseSchema = z
  .object({ entitlements_token: z.string() })
  .passthrough();

// Only `sub` (PUUID) is required. Riot omits or changes the other fields
// depending on how the account was created / logged in (e.g. social login via
// Google or Apple returns no `email_verified` / `pw`), so everything else is
// optional to avoid rejecting valid tokens.
export const UserInfoSchema = z
  .object({
    country: z.string().nullish(),
    sub: z.string(),
    email_verified: z.boolean().nullish(),
    phone_number_verified: z.boolean().nullish(),
    account_verified: z.boolean().nullish(),
    age: z.number().nullish(),
    jti: z.string().nullish(),
    player_plocale: z.string().nullish(),
    country_at: z.number().nullish(),
    pw: z
      .object({
        cng_at: z.number().nullish(),
        reset: z.boolean().nullish(),
        must_reset: z.boolean().nullish(),
      })
      .passthrough()
      .nullish(),
    ppid: z.string().nullish(),
    player_locale: z.string().nullish(),
    acct: z
      .object({
        type: z.number().nullish(),
        state: z.string().nullish(),
        adm: z.boolean().nullish(),
        game_name: z.string().nullish(),
        tag_line: z.string().nullish(),
        created_at: z.number().nullish(),
      })
      .passthrough()
      .nullish(),
    affinity: z.record(z.string(), z.string()).nullish(),
  })
  .passthrough();

export const AuthResponseSchema = z.object({
  // Riot answers HTTP 200 with types outside of `response`/`multifactor` when
  // the credentials are rejected or the IP is throttled, so the type stays open
  // and `riot-auth.ts` branches on the two known values instead. The exact type
  // string Riot sends on failure is not pinned down here on purpose.
  type: z.string().min(1),
  // Failure details `riot-auth.ts` reads off the response. Declared so `.strip()`
  // keeps them; `nullish` because rejecting the whole payload over a `null` here
  // would put us back on the generic message this schema exists to avoid.
  error: z.string().nullish(),
  country: z.string().nullish(),
  accessToken: z.string().min(1).optional(),
  idToken: z.string().min(1).optional(),
  expiresAt: z.number().positive().optional(),
  expiresIn: z.number().positive().optional(),
  // Not `.email()`: Riot masks this address (`u***@example.com`), which no email
  // validator accepts. Rejecting it fails the whole payload and sends the MFA
  // challenge down the generic-error path — the exact failure the comments above
  // exist to avoid. Nothing parses or sends this value; it is displayed as-is.
  multifactor: z.object({
    email: z.string().optional(),
    method: z.string().optional(),
  }).optional(),
  // Riot API returns tokens in response.parameters.uri for 'response' type
  response: z.object({
    mode: z.string().optional(),
    parameters: z.object({
      uri: z.string().optional(),
    }).optional(),
  }).optional(),
}).strip();
