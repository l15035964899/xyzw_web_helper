import { loadServerConnection, serverRequest } from "@/api/serverTasks";
import { expectedRoleIdFromToken } from "./roleIdentity.js";
import { createBrowserTokenValue } from "./serverTaskToken.js";
import { decodeLocalTokenPayload } from "./serverTokenSync.js";

const TOKEN_MAP_KEY = "xyzw_nas_token_id_map";
let hydrationPromise = null;

function normalizeSettings(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function findLocalToken(tokens, account, roleId) {
  return (
    (roleId != null
      ? tokens.find(
          (token) => expectedRoleIdFromToken(token) === String(roleId),
        ) || tokens.find((token) => String(token.roleId) === String(roleId))
      : null) ||
    tokens.find((token) => token.serverAccountId === account.id) ||
    tokens.find((token) => token.id === account.id)
  );
}

/**
 * Reconcile NAS-owned accounts into the browser token cache by stable roleId.
 */
export async function reconcileNasTokens({
  tokenStore,
  request = (path, options) =>
    serverRequest(path, { ...loadServerConnection(), ...options }),
}) {
  const accounts = await request("/api/tokens");
  if (!Array.isArray(accounts)) throw new Error("NAS 账号响应格式错误");
  const tokenIdMap = {};
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const account of accounts) {
    try {
      const parsed = decodeLocalTokenPayload(account.token);
      const roleId = account.roleId ?? parsed.roleId ?? null;
      const expectedRoleId =
        expectedRoleIdFromToken(account) ||
        (roleId != null ? String(roleId) : null);
      const existing = findLocalToken(
        tokenStore.gameTokens,
        account,
        expectedRoleId,
      );
      const fields = {
        token: createBrowserTokenValue(parsed),
        wsUrl: account.ws_url || account.wsUrl || null,
        server: account.server || "",
        roleId,
        expectedRoleId,
        lastVerifiedRoleId: account.last_verified_role_id || null,
        roleIdentityVerifiedAt: account.role_identity_verified_at || null,
        roleIdentityError: account.role_identity_error || null,
        serverAccountId: account.id,
        nasSyncedAt: new Date().toISOString(),
        importMethod: "nas",
        upgradedToPermanent: true,
      };

      if (existing) {
        tokenStore.updateToken(existing.id, {
          ...fields,
          name: existing.name || account.name,
        });
        tokenIdMap[existing.id] = account.id;
        updated += 1;
      } else {
        const createdToken = tokenStore.addToken({
          id: account.id,
          name: account.name || `角色-${roleId || account.id}`,
          ...fields,
        });
        tokenStore.updateToken(createdToken.id, fields);
        tokenIdMap[createdToken.id] = account.id;
        created += 1;
      }

      const settings = normalizeSettings(account.daily_settings);
      if (settings) {
        const localId =
          Object.entries(tokenIdMap).find(
            ([, serverId]) => serverId === account.id,
          )?.[0] || existing?.id;
        if (localId) {
          localStorage.setItem(
            `daily-settings:${localId}`,
            JSON.stringify(settings),
          );
        }
      }
    } catch {
      failed += 1;
    }
  }

  localStorage.setItem(TOKEN_MAP_KEY, JSON.stringify(tokenIdMap));
  return { accounts, tokenIdMap, created, updated, failed };
}

export function readNasTokenIdMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOKEN_MAP_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Hydrate once per page lifecycle. A failed attempt can be retried on the next navigation.
 */
export function ensureNasTokensHydrated(tokenStore) {
  if (!hydrationPromise) {
    hydrationPromise = reconcileNasTokens({ tokenStore }).catch((error) => {
      hydrationPromise = null;
      throw error;
    });
  }
  return hydrationPromise;
}

export function resetNasTokenHydration() {
  hydrationPromise = null;
}
