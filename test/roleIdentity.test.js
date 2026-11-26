import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedRoleIdFromToken as expectedBackendRoleId,
  findDuplicateExpectedRoles as findBackendDuplicates,
  verifyTokenRoleIdentity as verifyBackendIdentity,
} from "../render-backend/lib/roleIdentity.js";
import {
  expectedRoleIdFromToken as expectedBrowserRoleId,
  findDuplicateExpectedRoles as findBrowserDuplicates,
  verifyTokenRoleIdentity as verifyBrowserIdentity,
} from "../src/utils/roleIdentity.js";

for (const [label, expectedRoleId, findDuplicates, verifyIdentity] of [
  [
    "browser",
    expectedBrowserRoleId,
    findBrowserDuplicates,
    verifyBrowserIdentity,
  ],
  [
    "backend",
    expectedBackendRoleId,
    findBackendDuplicates,
    verifyBackendIdentity,
  ],
]) {
  test(`${label} identity uses the account role suffix instead of auth roleId`, () => {
    assert.equal(
      expectedRoleId({
        name: "AIRUI-0-82539560",
        roleId: 75758961,
      }),
      "82539560",
    );
    assert.equal(
      expectedRoleId({
        name: "重命名账号",
        expectedRoleId: 82539560,
        roleId: 75758961,
      }),
      "82539560",
    );
  });

  test(`${label} identity rejects a token that logs into another role`, () => {
    assert.throws(
      () =>
        verifyIdentity(
          { id: "a", name: "AIRUI-0-82539560" },
          { role: { roleId: 462554796, name: "AIRUI" } },
        ),
      (error) =>
        error.code === "ROLE_IDENTITY_MISMATCH" &&
        error.expectedRoleId === "82539560" &&
        error.actualRoleId === "462554796",
    );
  });

  test(`${label} identity accepts the matching live role`, () => {
    assert.deepEqual(
      verifyIdentity(
        { id: "a", name: "AIRUI-0-82539560" },
        { role: { roleId: 82539560, name: "AIRUI" } },
      ),
      {
        checked: true,
        expectedRoleId: "82539560",
        actualRoleId: "82539560",
      },
    );
  });

  test(`${label} duplicate expected roles block the whole ambiguous group`, () => {
    assert.deepEqual(
      findDuplicates([
        { id: "a", name: "账号-0-10001" },
        { id: "b", name: "账号-0-10001" },
        { id: "c", name: "账号-0-10002" },
      ]).map(({ roleId, tokens }) => ({
        roleId,
        ids: tokens.map((token) => token.id),
      })),
      [{ roleId: "10001", ids: ["a", "b"] }],
    );
  });
}
