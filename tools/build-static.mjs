// Renders the default hero plot to assets/img/rp-returns.png (the no-JavaScript fallback)
// with the same code the browser runs, and prints the year tick positions for the axes.
//   node tools/build-static.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';

const root = new URL('../', import.meta.url);
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(new URL('assets/js/aapl-data.js', root), 'utf8'));
vm.runInThisContext(fs.readFileSync(new URL('assets/js/rp.js', root), 'utf8'));
const { N, load, distances, epsFor, pixels, fmtDate } = globalThis.RP;

const D = load(globalThis.AAPL);
const cache = distances(D, 'returns');
const gray = new Uint8Array(N * N);
pixels(cache, epsFor(cache, 0.1), (p, on) => { gray[p] = on ? 11 : 255; });

const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const raw = Buffer.alloc((N + 1) * N);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) raw[y * (N + 1) + 1 + x] = gray[y * N + x];
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 0;
fs.writeFileSync(new URL('assets/img/rp-returns.png', root), Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]));

console.log('window', fmtDate(D.dates[D.s]), 'to', fmtDate(D.dates[D.s + N - 1]));
for (const y of ['2019', '2020', '2021']) {
  const i = D.dates.slice(D.s, D.s + N).findIndex((d) => d.startsWith(y));
  console.log(y, i, ((i / N) * 100).toFixed(2) + '%');
}
let top = [];
for (let i = 0; i < N; i++) top.push([Math.abs(D.ret[D.s + i]), i]);
top.sort((a, b) => b[0] - a[0]);
console.log('largest moves', top.slice(0, 6).map(([r, i]) => `${fmtDate(D.dates[D.s + i])} ${(D.ret[D.s + i] * 100).toFixed(2)}%`).join(', '));
