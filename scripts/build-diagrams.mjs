#!/usr/bin/env node
// images/**/<name>.diagram.mjs から <name>.svg と <name>.png を組む。
// 使い方:
//   node scripts/build-diagrams.mjs           組み直す（make writing-diagrams）
//   node scripts/build-diagrams.mjs --check   組み直さずに検査だけする（make writing-check / CI）
//
// 検査すること:
//   - どの図も、重なりの検査（scripts/diagram.mjs）を通る
//   - images/ の .svg はすべて .diagram.mjs から作ったもので、作り直した結果と一致する（手で直していない）
//   - 対応する .png がある
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDiagram, FONT } from './diagram.mjs';

const checkOnly = process.argv.includes('--check');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk('images');
const sources = files.filter((f) => f.endsWith('.diagram.mjs'));
const problems = [];

for (const svg of files.filter((f) => f.endsWith('.svg'))) {
  if (!existsSync(svg.replace(/\.svg$/, '.diagram.mjs'))) {
    problems.push(`${svg} に元の .diagram.mjs が無い（図は .diagram.mjs で組む。scripts/diagram.mjs）`);
  }
}

let Resvg;
let measure = null;
if (!checkOnly) {
  ({ Resvg } = await import('@resvg/resvg-js'));
  // 文字の幅を、PNG にするときと同じフォントで測る
  const cache = new Map();
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  measure = (text, size, weight) => {
    const key = `${size}/${weight}/${text}`;
    if (!cache.has(key)) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="200"><text x="0" y="100" font-family="${FONT}" font-size="${size}" font-weight="${weight}">${esc(text)}</text></svg>`;
      const bbox = new Resvg(svg, { font: { loadSystemFonts: true } }).getBBox();
      cache.set(key, bbox ? bbox.width : 0);
    }
    return cache.get(key);
  };
}

for (const src of sources) {
  const mod = await import(pathToFileURL(src).href);
  const d = createDiagram({ ...mod.size, measure });
  let svg;
  try {
    mod.default(d);
    svg = d.render();
  } catch (e) {
    problems.push(`${src}: ${e.message}`);
    continue;
  }
  const svgPath = src.replace(/\.diagram\.mjs$/, '.svg');
  const pngPath = src.replace(/\.diagram\.mjs$/, '.png');
  if (checkOnly) {
    if (!existsSync(svgPath) || readFileSync(svgPath, 'utf8') !== svg) {
      problems.push(`${svgPath} が ${src} から組み直した結果と違う（make writing-diagrams）`);
    }
    if (!existsSync(pngPath)) problems.push(`${pngPath} が無い（make writing-diagrams）`);
    continue;
  }
  writeFileSync(svgPath, svg);
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1400 },
    font: { loadSystemFonts: true },
  }).render().asPng();
  writeFileSync(pngPath, png);
  console.log(`built ${svgPath} / ${pngPath}`);
}

if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
if (checkOnly) console.log(`ok: 図 ${sources.length} 枚`);
