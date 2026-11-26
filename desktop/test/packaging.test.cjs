const assert = require("node:assert/strict");
const test = require("node:test");
const config = require("../electron-builder.cjs");

test("macOS package declares the local network privacy purpose", () => {
  assert.match(
    config.mac.extendInfo.NSLocalNetworkUsageDescription,
    /XYZW NAS/,
  );
});
