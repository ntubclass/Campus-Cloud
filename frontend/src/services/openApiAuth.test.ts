import { afterEach, describe, expect, it, vi } from "vitest"

import { AuthSessionService } from "@/services/authSession"

import { resolveOpenApiToken, shouldBypassOpenApiToken } from "./openApiAuth"

describe("openApiAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("bypasses auth headers for refresh and login endpoints", async () => {
    const getAccessTokenSpy = vi.spyOn(AuthSessionService, "getAccessToken")

    expect(
      shouldBypassOpenApiToken("/api/v1/login/refresh-token"),
    ).toBe(true)
    await expect(
      resolveOpenApiToken({ method: "POST", url: "/api/v1/login/refresh-token" }),
    ).resolves.toBe("")
    expect(getAccessTokenSpy).not.toHaveBeenCalled()
  })

  it("returns the stored token for protected endpoints", async () => {
    vi.spyOn(AuthSessionService, "getAccessToken").mockReturnValue("token-123")

    await expect(
      resolveOpenApiToken({ method: "GET", url: "/api/v1/users/me" }),
    ).resolves.toBe("token-123")
  })
})