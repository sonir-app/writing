#!/usr/bin/env node
// SVG を Zenn 表示用の PNG に書き出す。
// Zenn は /images で .svg を配信しないため、SVG をソースとして残しつつ PNG を生成して記事から参照する。
// 使い方:
//   node scripts/svg2png.mjs <input.svg> [width]
//   node scripts/svg2png.mjs images/<id>/diagram.svg 1400
// 出力は入力と同じパスの拡張子を .png に変えたもの。width 省略時は 1400px(Zenn 本文幅の約2倍で retina 相当)。
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const [input, widthArg] = process.argv.slice(2);
if (!input) {
  console.error('usage: node scripts/svg2png.mjs <input.svg> [width]');
  process.exit(1);
}
const width = Number(widthArg) || 1400;
const output = input.replace(/\.svg$/i, '') + '.png';

const svg = readFileSync(input);
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: width },
  font: { loadSystemFonts: true },
  background: 'transparent',
});
const png = resvg.render().asPng();
writeFileSync(output, png);
console.log(`${input} -> ${output} (${width}px, ${png.length} bytes)`);
