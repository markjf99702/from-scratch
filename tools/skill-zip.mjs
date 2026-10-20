// Packs the Claude skill into skill/from-scratch-cards.zip, the file people download from the Add page and upload in
// claude.ai:  node tools/skill-zip.mjs
// Run it after changing anything in skill/from-scratch-cards/; npm test fails while the zip is out of date.
// The zip holds the folder itself (from-scratch-cards/SKILL.md, …), the way claude.ai wants a skill. Files are stored
// as they are, in name order, with a fixed date, so the same folder always makes the same zip on any computer.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ZIP = join(root, 'skill', 'from-scratch-cards.zip');

// What goes in: everything in the folder except Python's caches and the Mac's folder notes.
export function skillFiles() {
  const out = [];
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['__pycache__', 'node_modules', '.DS_Store'].includes(e.name) || e.name.endsWith('.pyc')) continue;
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.isFile()) out.push([relative(join(root, 'skill'), path).split(sep).join('/'), readFileSync(path)]);
    }
  };
  walk(join(root, 'skill', 'from-scratch-cards'));
  return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// [[name, contents], …] → the bytes of a zip file.
export function makeZip(files) {
  const DAY = (1 << 5) | 1; // 1 January 1980, the earliest date a zip can hold
  const parts = [], central = [];
  let at = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name, 'utf8'), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // needs zip 2.0 to read; flags 0, stored (no compression), time 0
    local.writeUInt16LE(DAY, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(0x0314, 4); // made on Unix, zip 2.0
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(DAY, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(n.length, 28);
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38); // an ordinary file, rw-r--r--
    entry.writeUInt32LE(at, 42);
    parts.push(local, n, data);
    central.push(entry, n);
    at += local.length + n.length + data.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(at, 16);
  return Buffer.concat([...parts, dir, end]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = skillFiles(), zip = makeZip(files);
  writeFileSync(ZIP, zip);
  console.log(`skill/from-scratch-cards.zip  ${files.length} files, ${(zip.length / 1024).toFixed(1)} KB`);
}
