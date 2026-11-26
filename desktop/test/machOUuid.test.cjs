const assert = require("node:assert/strict");
const { Buffer } = require("node:buffer");
const test = require("node:test");
const { patchMachOUuidBuffer } = require("../scripts/patch-electron-uuid.cjs");

function createMachO64(uuid) {
  const data = Buffer.alloc(64);
  data.writeUInt32LE(0xfeedfacf, 0);
  data.writeUInt32LE(1, 16);
  data.writeUInt32LE(0x1b, 32);
  data.writeUInt32LE(24, 36);
  Buffer.from(uuid.replaceAll("-", ""), "hex").copy(data, 40);
  return data;
}

test("desktop build assigns a unique LC_UUID to the macOS executable", () => {
  const original = "4C4C44A8-5555-3144-A1F2-5BAF2B080485";
  const generated = "c8e36b1a-b433-43d3-8998-9991b8608111";
  const data = createMachO64(original);

  assert.deepEqual(
    patchMachOUuidBuffer(data, { uuidFactory: () => generated }),
    [generated],
  );
  assert.equal(
    data.subarray(40, 56).toString("hex"),
    generated.replaceAll("-", ""),
  );
});

test("desktop build rejects a Mach-O executable without LC_UUID", () => {
  const data = Buffer.alloc(64);
  data.writeUInt32LE(0xfeedfacf, 0);
  data.writeUInt32LE(0, 16);
  assert.throws(() => patchMachOUuidBuffer(data), /LC_UUID/);
});
