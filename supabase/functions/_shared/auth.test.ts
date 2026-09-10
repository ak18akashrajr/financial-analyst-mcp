// Unit tests for requireUser()/unauthorizedResponse() — the per-user auth
// gate that portfolio-ai and portfolio-mcp-server rely on instead of the
// platform's verify_jwt (which accepts the public anon key, not just real
// user sessions). Supabase's own `auth.getUser` call is mocked so this
// exercises requireUser's own logic (token extraction, null-handling)
// without a live network call.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: getUserMock } }),
}));

let requireUser: typeof import("./auth.ts").requireUser;
let unauthorizedResponse: typeof import("./auth.ts").unauthorizedResponse;

beforeEach(async () => {
  vi.stubGlobal("Deno", {
    env: {
      get: (key: string) => {
        if (key === "SUPABASE_URL") return "https://example.supabase.co";
        if (key === "SUPABASE_ANON_KEY") return "test-anon-key";
        return undefined;
      },
    },
  });
  getUserMock.mockReset();
  ({ requireUser, unauthorizedResponse } = await import("./auth.ts"));
});

function reqWithAuth(header?: string): Request {
  return new Request("https://example.com/portfolio-ai", {
    method: "POST",
    headers: header ? { Authorization: header } : {},
  });
}

describe("requireUser", () => {
  it("returns a null user with reason 'no_token' when the request has no Authorization header", async () => {
    const result = await requireUser(reqWithAuth());
    expect(result.user).toBeNull();
    expect(result.reason).toBe("no_token");
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("returns a null user with the real Supabase error in reason when the bearer token doesn't belong to a real session (e.g. the anon key)", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "invalid JWT" } });
    const result = await requireUser(reqWithAuth("Bearer some-anon-key"));
    expect(result.user).toBeNull();
    expect(result.reason).toBe("invalid_token: invalid JWT");
  });

  it("returns reason 'invalid_token' with no message when Supabase reports no error but also no user", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const result = await requireUser(reqWithAuth("Bearer some-token"));
    expect(result.user).toBeNull();
    expect(result.reason).toBe("invalid_token: no user for token");
  });

  it("returns the user id and a null reason for a valid session token", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-123" } }, error: null });
    const result = await requireUser(reqWithAuth("Bearer real-session-token"));
    expect(result.user).toEqual({ id: "user-123" });
    expect(result.reason).toBeNull();
    expect(getUserMock).toHaveBeenCalledWith("real-session-token");
  });
});

describe("unauthorizedResponse", () => {
  it("returns a 401 with the caller's own CORS headers merged in", async () => {
    const res = unauthorizedResponse({ "Access-Control-Allow-Origin": "*" });
    expect(res.status).toBe(401);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = await res.json();
    expect(body.error).toMatch(/sign in/i);
  });
});
