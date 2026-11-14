import { createBrowserTokenValue } from "./serverTaskToken.js";

function tryJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizePayload(value) {
  return {
    roleToken: value.roleToken,
    roleId: value.roleId ?? null,
    sessId: value.sessId ?? null,
    connId: value.connId ?? null,
    isRestore: value.isRestore ?? 0,
  };
}

export function decodeLocalTokenPayload(raw) {
  const value = String(raw || "").trim();
  if (!value) throw new Error("Token 不能为空");
  const direct = tryJson(value);
  if (direct?.roleToken) return normalizePayload(direct);

  const unwrapped = value.replace(/^["']|["']$/g, "");
  for (const candidate of [
    unwrapped,
    unwrapped.replace(/-/g, "+").replace(/_/g, "/"),
    unwrapped.split("").reverse().join(""),
  ]) {
    const padded = candidate.padEnd(
      candidate.length + ((4 - (candidate.length % 4)) % 4),
      "=",
    );
    try {
      const decoded = JSON.parse(atob(padded));
      if (decoded?.roleToken) return normalizePayload(decoded);
    } catch {
      // Try the next supported local token encoding.
    }
  }
  throw new Error("无法解析本地 Token");
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function readLocalSettings(tokenId) {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(`daily-settings:${tokenId}`) || "null",
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * Upsert browser-local tokens and their per-account settings into the NAS store.
 * Existing server accounts are matched by roleId so task selections stay intact.
 * @param {object} options Sync inputs and API transport.
 * @param {Array} options.tokens Browser token records.
 * @param {Function} options.request Authenticated server request function.
 * @param {Function} [options.getRefreshCredential] Reads the account's BIN bytes.
 * @returns {Promise<object>} Sync counts, ID map and resulting accounts.
 */
export async function syncLocalTokensToServer({
  tokens = [],
  request,
  getRefreshCredential = null,
}) {
  const current = await request("/api/tokens");
  const serverTokens = Array.isArray(current) ? current : [];
  const byRoleId = new Map(
    serverTokens
      .filter((token) => token.roleId != null)
      .map((token) => [String(token.roleId), token]),
  );
  let created = 0;
  let updated = 0;
  let failed = 0;
  let refreshCredentialsConfigured = 0;
  let refreshCredentialsMissing = 0;
  let refreshCredentialsFailed = 0;
  const tokenIdMap = {};

  for (const token of tokens) {
    try {
      const parsed = decodeLocalTokenPayload(token.token);
      const roleId = token.roleId ?? parsed.roleId ?? null;
      const existing =
        (roleId != null ? byRoleId.get(String(roleId)) : null) ||
        serverTokens.find((item) => item.id === token.id);
      const body = {
        name: token.name,
        token: createBrowserTokenValue(parsed),
        roleId,
        sessId: parsed.sessId,
        connId: parsed.connId,
        isRestore: parsed.isRestore,
        ws_url: token.wsUrl || null,
        server: token.server || null,
        importMethod: token.importMethod || existing?.importMethod || null,
        daily_settings: readLocalSettings(token.id),
        enabled: existing ? Boolean(existing.enabled) : token.enabled !== false,
      };
      let serverTokenId = existing?.id || null;

      if (existing) {
        const [updatedToken] = await request(
          `/api/tokens/${encodeURIComponent(existing.id)}`,
          {
            method: "PATCH",
            body,
          },
        );
        const index = serverTokens.findIndex((item) => item.id === existing.id);
        if (index >= 0 && updatedToken) serverTokens[index] = updatedToken;
        tokenIdMap[token.id] = existing.id;
        serverTokenId = existing.id;
        updated += 1;
      } else {
        const [createdToken] = await request("/api/tokens", {
          method: "POST",
          body: { ...body, id: token.id },
        });
        serverTokens.push(createdToken);
        tokenIdMap[token.id] = createdToken.id;
        serverTokenId = createdToken.id;
        if (roleId != null) {
          byRoleId.set(String(roleId), createdToken);
        }
        created += 1;
      }

      if (getRefreshCredential && serverTokenId) {
        try {
          const credential = await getRefreshCredential(token);
          if (!credential) {
            refreshCredentialsMissing += 1;
          } else {
            await request(
              `/api/tokens/${encodeURIComponent(serverTokenId)}/refresh-credential`,
              {
                method: "PUT",
                body: { bin_base64: arrayBufferToBase64(credential) },
              },
            );
            refreshCredentialsConfigured += 1;
          }
        } catch {
          refreshCredentialsFailed += 1;
        }
      }
    } catch {
      failed += 1;
    }
  }

  return {
    created,
    updated,
    failed,
    refreshCredentialsConfigured,
    refreshCredentialsMissing,
    refreshCredentialsFailed,
    tokenIdMap,
    accounts: serverTokens,
  };
}
