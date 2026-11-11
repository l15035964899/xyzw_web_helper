export function createBrowserTokenValue(payload = {}) {
  const roleToken = String(payload.roleToken || "").trim();
  if (!roleToken) throw new Error("Token 缺少 roleToken");
  return JSON.stringify({
    roleToken,
    roleId: payload.roleId ?? null,
    sessId: payload.sessId ?? null,
    connId: payload.connId ?? null,
    isRestore: payload.isRestore ?? 0,
  });
}
