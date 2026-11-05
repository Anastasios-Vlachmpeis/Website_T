// Builds assets/favicon.svg: the hero's recurrence plot of AAPL log returns, thresholded onto a small grid.
// A cell is dark when enough of the plot's recurrent points fall inside it, and the diagonal is always dark.
//   node tools/build-favicon.mjs [grid] [out]
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const grid = +(process.argv[2] || 24);
const out = process.argv[3] || new URL('assets/favicon.svg', root);

globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(new URL('assets/js/aapl-data.js', root), 'utf8'));
vm.runInThisContext(fs.readFileSync(new URL('assets/js/rp.js', root), 'utf8'));
const { N, load, distances, epsFor, pixels } = globalThis.RP;

const cache = distances(load(globalThis.AAPL), 'returns');
const on = new Uint8Array(N * N);
pixels(cache, epsFor(cache, 0.1), (p, v) => { on[p] = v ? 1 : 0; });

const density = new Float64Array(grid * grid);
// Bin rows by time, not by screen position, so the cells stay symmetric across the diagonal.
for (let y = 0; y < N; y++) {
  const row = grid - 1 - Math.floor(((N - 1 - y) * grid) / N);
  for (let x = 0; x < N; x++) density[row * grid + Math.floor((x * grid) / N)] += on[y * N + x];
}
// Keep the densest fifth of cells, so the blocks of calm days stay and the pale March 2020 cross stays empty.
const cut = [...density].sort((a, b) => b - a)[Math.floor(grid * grid * 0.2)];

let path = '';
for (let y = 0; y < grid; y++) {
  for (let x = 0; x < grid; x++) {
    if (density[y * grid + x] > cut || x + y === grid - 1) path += `M${x} ${y}h1v1h-1z`;
  }
}
fs.writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid} ${grid}" shape-rendering="crispEdges">
  <rect width="${grid}" height="${grid}" fill="#ffffff"/>
  <path fill="#0b0b0c" d="${path}"/>
</svg>
`);
