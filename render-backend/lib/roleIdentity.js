const ROLE_ID_SUFFIX = /-(\d{5,})$/u;

function normalizeRoleId(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

/**
 * Resolve the role identity that an account record is expected to log into.
 * Explicit verification metadata wins; imported account names use their
 * trailing numeric role id. The auth payload roleId is intentionally not a
 * fallback because it can identify a login/session rather than the game role.
 */
export function expectedRoleIdFromToken(token) {
  return (
    normalizeRoleId(token?.expectedRoleId ?? token?.expected_role_id) ||
    normalizeRoleId(String(token?.name || "").match(ROLE_ID_SUFFIX)?.[1])
  );
}

export function actualRoleIdFromRoleInfo(response) {
  const role =
    response?.role ?? response?.data?.role ?? response?.roleInfo ?? response;
  return normalizeRoleId(role?.roleId ?? role?.id);
}

export function createRoleIdentityError({
  token,
  expectedRoleId,
  actualRoleId,
  reason = "mismatch",
}) {
  const name = token?.name || token?.id || "未知账号";
  const message =
    reason === "missing-actual"
      ? `角色身份校验失败：账号“${name}”没有返回实际角色 ID`
      : `角色身份不匹配：账号“${name}”预期角色 ${expectedRoleId}，实际登录 ${actualRoleId}`;
  const error = new Error(message);
  error.code = "ROLE_IDENTITY_MISMATCH";
  error.roleIdentityMismatch = true;
  error.expectedRoleId = expectedRoleId;
  error.actualRoleId = actualRoleId;
  return error;
}

/**
 * Verify a live role_getroleinfo response against the account's expected role.
 * Tokens without a derivable expected role are reported as unchecked so legacy
 * manually named accounts keep working until they are given a stable identity.
 */
export function verifyTokenRoleIdentity(token, response) {
  const expectedRoleId = expectedRoleIdFromToken(token);
  if (!expectedRoleId) {
    return {
      checked: false,
      expectedRoleId: null,
      actualRoleId: actualRoleIdFromRoleInfo(response),
    };
  }
  const actualRoleId = actualRoleIdFromRoleInfo(response);
  if (!actualRoleId) {
    throw createRoleIdentityError({
      token,
      expectedRoleId,
      actualRoleId,
      reason: "missing-actual",
    });
  }
  if (actualRoleId !== expectedRoleId) {
    throw createRoleIdentityError({
      token,
      expectedRoleId,
      actualRoleId,
    });
  }
  return {
    checked: true,
    expectedRoleId,
    actualRoleId,
  };
}

export function findDuplicateExpectedRoles(tokens = []) {
  const groups = new Map();
  for (const token of tokens) {
    const roleId = expectedRoleIdFromToken(token);
    if (!roleId) continue;
    const group = groups.get(roleId) || [];
    group.push(token);
    groups.set(roleId, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([roleId, group]) => ({ roleId, tokens: group }));
}
