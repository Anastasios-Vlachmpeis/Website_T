// Slices AAPL closes from apple_stock.csv (github.com/Anastasios-Vlachmpeis/Apple-Stock-Log-Return-Prediction)
// into assets/js/aapl-data.js for the hero recurrence plot.
//   node tools/build-aapl.mjs <path to apple_stock.csv>
import fs from 'node:fs';

const FROM = '2018-11-01'; // 40 days of lead for the 20-day volatility and the embedding
const TO = '2021-01-29';

const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
const keep = rows.filter((r) => r[0] >= FROM && r[0] <= TO);
const dates = keep.map((r) => r[0].replaceAll('-', ''));
// Adjusted close: the raw close has the 4:1 split of 31 Aug 2020 in it, a fake -138% log return.
const close = keep.map((r) => +(+r[1]).toFixed(4));

fs.writeFileSync(
  new URL('../assets/js/aapl-data.js', import.meta.url),
  `// AAPL daily adjusted close, ${keep[0][0]} to ${keep.at(-1)[0]}. Built by tools/build-aapl.mjs.\n` +
  `window.AAPL={d:${JSON.stringify(dates.join(''))},c:${JSON.stringify(close)}};\n`
);
console.log(keep.length, 'rows');
