import type { ApiRequestOptions } from "@/client/core/ApiRequestOptions"

import { AuthSessionService } from "./authSession"

const AUTH_TOKEN_BYPASS_PREFIXES = [
  "/api/v1/login/access-token",
  "/api/v1/login/google",
  "/api/v1/login/refresh-token",
  "/api/v1/password-recovery",
  "/api/v1/reset-password",
]

export function shouldBypassOpenApiToken(url: string): boolean {
  return AUTH_TOKEN_BYPASS_PREFIXES.some(
    (prefix) => url === prefix || url.startsWith(`${prefix}/`),
  )
}

export function resolveOpenApiToken(
  options: ApiRequestOptions<unknown>,
): Promise<string> {
  if (shouldBypassOpenApiToken(options.url)) {
    return Promise.resolve("")
  }

  return Promise.resolve(AuthSessionService.getAccessToken() || "")
}