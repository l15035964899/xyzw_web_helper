const { Buffer } = require("node:buffer");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const LC_UUID = 0x1b;
const MH_MAGIC = 0xfeedface;
const MH_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const FAT_CIGAM = 0xbebafeca;
const FAT_MAGIC_64 = 0xcafebabf;
const FAT_CIGAM_64 = 0xbfbafeca;

function parseUuid(value) {
  const uuid = String(value || "");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      uuid,
    )
  ) {
    throw new Error("Invalid Mach-O UUID");
  }
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

function patchThinMachOUuid(
  data,
  { start = 0, end = data.length, uuidFactory = crypto.randomUUID } = {},
) {
  if (start + 4 > end) throw new Error("Truncated Mach-O header");
  const magic = data.readUInt32LE(start);
  if (magic !== MH_MAGIC && magic !== MH_MAGIC_64) {
    throw new Error("Unsupported Mach-O executable");
  }

  const headerSize = magic === MH_MAGIC_64 ? 32 : 28;
  const commandCount = data.readUInt32LE(start + 16);
  let offset = start + headerSize;
  for (let index = 0; index < commandCount; index += 1) {
    if (offset + 8 > end) throw new Error("Truncated Mach-O load command");
    const command = data.readUInt32LE(offset);
    const commandSize = data.readUInt32LE(offset + 4);
    if (commandSize < 8 || offset + commandSize > end) {
      throw new Error("Invalid Mach-O load command");
    }
    if (command === LC_UUID) {
      if (commandSize < 24) throw new Error("Invalid LC_UUID command");
      const uuid = uuidFactory();
      parseUuid(uuid).copy(data, offset + 8);
      return uuid;
    }
    offset += commandSize;
  }
  throw new Error("Mach-O executable has no LC_UUID command");
}

function patchMachOUuidBuffer(data, options = {}) {
  if (data.length < 8) throw new Error("Truncated Mach-O executable");
  const fatMagic = data.readUInt32BE(0);
  if (![FAT_MAGIC, FAT_CIGAM, FAT_MAGIC_64, FAT_CIGAM_64].includes(fatMagic)) {
    return [patchThinMachOUuid(data, options)];
  }

  const littleEndian = fatMagic === FAT_CIGAM || fatMagic === FAT_CIGAM_64;
  const readUInt32 = (offset) =>
    littleEndian ? data.readUInt32LE(offset) : data.readUInt32BE(offset);
  const readUInt64 = (offset) =>
    littleEndian ? data.readBigUInt64LE(offset) : data.readBigUInt64BE(offset);
  const is64Bit = fatMagic === FAT_MAGIC_64 || fatMagic === FAT_CIGAM_64;
  const archCount = readUInt32(4);
  const archSize = is64Bit ? 32 : 20;
  const tableEnd = 8 + archCount * archSize;
  if (tableEnd > data.length)
    throw new Error("Truncated universal binary table");

  return Array.from({ length: archCount }, (_, index) => {
    const archOffset = 8 + index * archSize;
    const start = Number(
      is64Bit ? readUInt64(archOffset + 8) : readUInt32(archOffset + 8),
    );
    const size = Number(
      is64Bit ? readUInt64(archOffset + 16) : readUInt32(archOffset + 12),
    );
    if (start < tableEnd || size <= 0 || start + size > data.length) {
      throw new Error("Invalid universal binary slice");
    }
    return patchThinMachOUuid(data, {
      ...options,
      start,
      end: start + size,
    });
  });
}

async function patchMachOUuidFile(filePath, options) {
  const data = await fs.readFile(filePath);
  const uuids = patchMachOUuidBuffer(data, options);
  await fs.writeFile(filePath, data);
  return uuids;
}

module.exports = async function patchElectronUuid(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = context.packager.appInfo.productFilename;
  const executable = path.join(
    context.appOutDir,
    `${appName}.app`,
    "Contents",
    "MacOS",
    appName,
  );
  const uuids = await patchMachOUuidFile(executable);
  console.log(`Patched macOS application UUID: ${uuids.join(", ")}`);
};

module.exports.patchMachOUuidBuffer = patchMachOUuidBuffer;
module.exports.patchMachOUuidFile = patchMachOUuidFile;
