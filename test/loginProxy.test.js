import assert from "node:assert/strict";
import test from "node:test";
import { resolveLoginProxy } from "../render-backend/lib/loginProxy.js";

test("login proxy selects the longest matching upstream prefix", () => {
  assert.equal(
    resolveLoginProxy("/api/weixin-long/getqrcode")?.target,
    "https://long.open.weixin.qq.com",
  );
  assert.equal(
    resolveLoginProxy("/api/weixin/getqrcode")?.target,
    "https://open.weixin.qq.com",
  );
  assert.equal(
    resolveLoginProxy("/api/hortor-ucenter/auth/send")?.target,
    "https://ucenter-app-server.hortorgames.com",
  );
  assert.equal(
    resolveLoginProxy("/api/hortor/qrcode")?.target,
    "https://comb-platform.hortorgames.com",
  );
  assert.equal(resolveLoginProxy("/api/tokens"), undefined);
});
