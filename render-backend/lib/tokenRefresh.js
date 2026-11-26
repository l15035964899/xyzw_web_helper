import { Buffer } from "node:buffer";
import { randomInt } from "node:crypto";
import { getEnc, parse } from "./bonProtocol.js";
import { expectedRoleIdFromToken } from "./roleIdentity.js";

export const DEFAULT_TOKEN_REFRESH_MAX_AGE_MS = 20 * 60 * 60 * 1000;
export const DEFAULT_TOKEN_REFRESH_DELAY_MS = 2500;
const AUTH_USER_URL = "https://xxz-xyzw.hortorgames.com/login/authuser";

function getTokenPayload(token) {
  try {
    const value =
      typeof token?.token === "string" ? JSON.parse(token.token) : token?.token;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function getTokenIssuedAt(token) {
  const payload = getTokenPayload(token);
  const connId = Number(payload.connId ?? token?.connId);
  return Number.isFinite(connId) && connId > 1e12 ? connId : null;
}

export function getTokenAgeMs(token, now = Date.now()) {
  const issuedAt = getTokenIssuedAt(token);
  return issuedAt == null ? null : Math.max(0, now - issuedAt);
}

export function tokenNeedsRefresh(
  token,
  now = Date.now(),
  maxAgeMs = DEFAULT_TOKEN_REFRESH_MAX_AGE_MS,
) {
  const ageMs = getTokenAgeMs(token, now);
  return ageMs == null || ageMs >= maxAgeMs;
}

export async function refreshTokenFromBin(
  bin,
  {
    fetchImpl = globalThis.fetch,
    now = Date.now(),
    authUserUrl = AUTH_USER_URL,
  } = {},
) {
  const body = Buffer.isBuffer(bin) ? bin : Buffer.from(bin || []);
  if (body.length === 0) throw new Error("BIN 登录凭据为空");

  const response = await fetchImpl(`${authUserUrl}?_seq=1`, {
    method: "POST",
    headers: {
      Accept: "application/octet-stream",
      "Content-Type": "application/octet-stream",
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Token 登录刷新失败: HTTP ${response.status}`);
  }

  const message = parse(await response.arrayBuffer(), getEnc("auto"));
  const data = message?.getData?.() || message?.rawData;
  if (!data?.roleToken) throw new Error("Token 登录刷新响应缺少 roleToken");

  const currentTime = typeof now === "function" ? now() : Number(now);
  const payload = {
    ...data,
    sessId: currentTime * 100 + randomInt(0, 100),
    connId: currentTime + randomInt(0, 10),
    isRestore: 0,
  };
  return {
    token: JSON.stringify(payload),
    payload,
    refreshedAt: new Date(currentTime).toISOString(),
  };
}

export async function refreshCredentialAndUpdateToken({
  token,
  credential,
  dataStore,
  refresh = refreshTokenFromBin,
  verifyRefreshedToken = null,
  now = Date.now,
}) {
  if (!credential?.bin) {
    const error = new Error("缺少 BIN 自动刷新凭据");
    error.code = "MISSING_REFRESH_CREDENTIAL";
    throw error;
  }
  const refreshed = await refresh(credential.bin, { now });
  const verification = verifyRefreshedToken
    ? await verifyRefreshedToken(token, refreshed)
    : null;
  const updated = await dataStore.updateToken(token.id, {
    token: refreshed.token,
    roleId: refreshed.payload.roleId ?? token.roleId,
    sessId: refreshed.payload.sessId,
    connId: refreshed.payload.connId,
    isRestore: refreshed.payload.isRestore,
    last_refreshed_at: refreshed.refreshedAt,
    token_refresh_source: "bin",
    expected_role_id:
      token.expected_role_id ??
      token.expectedRoleId ??
      expectedRoleIdFromToken(token),
    last_verified_role_id: verification?.actualRoleId ?? null,
    role_identity_verified_at: verification ? refreshed.refreshedAt : null,
    role_identity_error: null,
  });
  return {
    refreshed,
    verification,
    updated: updated || {
      ...token,
      token: refreshed.token,
      connId: refreshed.payload.connId,
      sessId: refreshed.payload.sessId,
      isRestore: refreshed.payload.isRestore,
    },
  };
}

export function createTokenRefreshManager({
  dataStore,
  addLog = () => {},
  maxAgeMs = DEFAULT_TOKEN_REFRESH_MAX_AGE_MS,
  refreshDelayMs = DEFAULT_TOKEN_REFRESH_DELAY_MS,
  refresh = refreshTokenFromBin,
  verifyRefreshedToken = null,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let activeRun = null;
  const missingCredentialWarnings = new Set();

  async function run({ tokenIds = null, force = false } = {}) {
    if (activeRun) return activeRun;
    activeRun = (async () => {
      const requestedIds = Array.isArray(tokenIds)
        ? new Set(tokenIds.map(String))
        : null;
      const tokens = await dataStore.listTokens({ enabledOnly: true });
      const candidates = tokens.filter(
        (token) =>
          (!requestedIds || requestedIds.has(String(token.id))) &&
          (force || tokenNeedsRefresh(token, now(), maxAgeMs)),
      );
      const summary = {
        checked: tokens.length,
        due: candidates.length,
        refreshed: 0,
        missingCredentials: 0,
        failed: 0,
      };

      for (let index = 0; index < candidates.length; index += 1) {
        const token = candidates[index];
        if (index > 0 && refreshDelayMs > 0) await sleep(refreshDelayMs);
        const credential = await dataStore.getTokenRefreshCredential?.(
          token.id,
        );
        if (!credential?.bin) {
          summary.missingCredentials += 1;
          if (!missingCredentialWarnings.has(token.id)) {
            missingCredentialWarnings.add(token.id);
            addLog(
              "WARN",
              "token",
              `${token.name}: 缺少 BIN 自动刷新凭据，请重新同步账号`,
              { tokenId: token.id },
            );
          }
          continue;
        }

        try {
          const { refreshed } = await refreshCredentialAndUpdateToken({
            token,
            credential,
            dataStore,
            refresh,
            verifyRefreshedToken,
            now,
          });
          await dataStore.markTokenRefreshResult?.(token.id, {
            success: true,
            attemptedAt: refreshed.refreshedAt,
            refreshedAt: refreshed.refreshedAt,
          });
          missingCredentialWarnings.delete(token.id);
          summary.refreshed += 1;
          addLog("INFO", "token", `${token.name}: Token 自动刷新成功`, {
            tokenId: token.id,
          });
        } catch (error) {
          const attemptedAt = new Date(
            typeof now === "function" ? now() : now,
          ).toISOString();
          if (error.roleIdentityMismatch) {
            await dataStore
              .updateToken?.(token.id, {
                expected_role_id:
                  token.expected_role_id ??
                  token.expectedRoleId ??
                  expectedRoleIdFromToken(token),
                last_verified_role_id: null,
                role_identity_verified_at: null,
                role_identity_error: error.message,
              })
              .catch(() => {});
          }
          await dataStore.markTokenRefreshResult?.(token.id, {
            success: false,
            attemptedAt,
            error: error.message,
          });
          summary.failed += 1;
          addLog(
            "ERROR",
            "token",
            `${token.name}: Token 自动刷新失败: ${error.message}`,
            { tokenId: token.id },
          );
        }
      }

      return summary;
    })().finally(() => {
      activeRun = null;
    });
    return activeRun;
  }

  async function status() {
    const tokens = await dataStore.listTokens();
    const credentials =
      (await dataStore.listTokenRefreshCredentialStatuses?.()) || {};
    const currentTime = now();
    return {
      max_age_hours: Math.round(maxAgeMs / 36e5),
      tokens: tokens.map((token) => {
        const credential = credentials[token.id] || null;
        const ageMs = getTokenAgeMs(token, currentTime);
        return {
          id: token.id,
          name: token.name,
          enabled: token.enabled,
          age_hours:
            ageMs == null ? null : Math.round((ageMs / 36e5) * 10) / 10,
          due: tokenNeedsRefresh(token, currentTime, maxAgeMs),
          refresh_credential_configured: Boolean(credential),
          credential_updated_at: credential?.updated_at || null,
          last_refresh_at: credential?.last_refresh_at || null,
          last_refresh_attempt_at: credential?.last_attempt_at || null,
          last_refresh_error: credential?.last_error || null,
        };
      }),
    };
  }

  return { run, status };
}
