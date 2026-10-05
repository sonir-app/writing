// 記事の図（箱と矢印）を組む小さな部品。手書きの SVG で踏んだ壊れ方を、組む時点で落とす。
//
// - 矢じりは <marker> を使わず三角形で描く（resvg が marker をずれた形で描くため）
// - 矢印の端は箱の辺から GAP だけ離す（座標を手で合わせると先が枠に食い込む）
// - 矢印は水平・垂直の線分だけで引く（斜めは折れ点を足して直す）
// - 矢印が、つないでいない箱に重なったら throw する
// - 文字が箱や矢印に重なる・箱に収まらないときも throw する。文字の幅は measure（実際のフォントで測る関数）
//   を渡したときだけ測る。渡さなければ文字の検査は飛ばす（フォントの違う CI で結果がぶれないように）
//
// 使い方は images/<slug>/<name>.diagram.mjs から `export default (d) => { d.box(...); d.arrow(...) }`。
// 組むのは scripts/build-diagrams.mjs（make writing-diagrams）。

const GAP = 6; // 矢印の端と箱の辺のすき間
const HEAD_LEN = 12;
const HEAD_HALF = 6;
const FONT = 'Helvetica Neue, Helvetica, Arial, sans-serif';

const COLORS = {
  line: '#334155',
  accent: '#2563eb',
  title: '#0f172a',
  sub: '#475569',
};

const STYLES = {
  plain: { fill: '#f1f5f9', stroke: '#94a3b8', width: 1 },
  soft: { fill: '#f8fafc', stroke: '#94a3b8', width: 1 },
  accent: { fill: '#eff6ff', stroke: '#2563eb', width: 1 },
  strong: { fill: '#eff6ff', stroke: '#2563eb', width: 2 },
  container: { fill: '#ffffff', stroke: '#0f172a', width: 2 },
};

export { FONT };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 2つの矩形が重なるか（辺が触れるだけは重ならないとみなす）
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// 矩形 a が矩形 b の中に完全に入っているか
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

export function createDiagram({ width, height, background = '#ffffff', measure = null }) {
  const boxes = new Map();
  const arrows = [];
  const texts = [];
  const errors = [];

  // 箱。container は中に他の箱や文字を持てる（daemon の枠など）
  function box(id, { x, y, w, h, title, sub = [], style = 'plain', titleAlign = 'center', titleSize = 20 }) {
    if (boxes.has(id)) throw new Error(`箱の id が重複している: ${id}`);
    const lines = Array.isArray(sub) ? sub : [sub];
    boxes.set(id, { id, x, y, w, h, title, sub: lines, style, titleAlign, titleSize, container: style === 'container' });
  }

  // 辺の上の点。at は辺に沿った絶対座標（省略すると辺の中点）
  function anchor({ box: id, side, at }) {
    const b = boxes.get(id);
    if (!b) throw new Error(`矢印の先の箱が無い: ${id}`);
    switch (side) {
      case 'top': return { x: at ?? b.x + b.w / 2, y: b.y - GAP, dir: [0, -1], b };
      case 'bottom': return { x: at ?? b.x + b.w / 2, y: b.y + b.h + GAP, dir: [0, 1], b };
      case 'left': return { x: b.x - GAP, y: at ?? b.y + b.h / 2, dir: [-1, 0], b };
      case 'right': return { x: b.x + b.w + GAP, y: at ?? b.y + b.h / 2, dir: [1, 0], b };
      default: throw new Error(`side は top / bottom / left / right: ${side}`);
    }
  }

  // 矢印。via は折れ点。both で両端に矢じり。dashed で破線
  function arrow({ from, to, via = [], both = false, dashed = false, color = 'line' }) {
    const a = anchor(from);
    const z = anchor(to);
    for (const [p, side] of [[a, from.side], [z, to.side]]) {
      const b = p.b;
      const along = side === 'top' || side === 'bottom' ? p.x : p.y;
      const lo = side === 'top' || side === 'bottom' ? b.x : b.y;
      const hi = side === 'top' || side === 'bottom' ? b.x + b.w : b.y + b.h;
      if (along <= lo || along >= hi) throw new Error(`矢印の端が箱 ${b.id} の ${side} の辺から外れている（${along}）`);
    }
    const pts = [{ x: a.x, y: a.y }, ...via.map(([x, y]) => ({ x, y })), { x: z.x, y: z.y }];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      if (p.x !== q.x && p.y !== q.y) throw new Error(`矢印 ${from.box}→${to.box} に斜めの線分がある（折れ点を足す）`);
    }
    arrows.push({ pts, both, dashed, color, ends: [from.box, to.box] });
  }

  // 箱の外に置く文字（矢印の説明など）
  function label(text, { x, y, size = 14, color = 'sub', anchor: ta = 'start' }) {
    texts.push({ text, x, y, size, color, anchor: ta });
  }

  function textRect({ text, x, y, size, anchor: ta }) {
    const w = measure(text, size, 400);
    const left = ta === 'middle' ? x - w / 2 : ta === 'end' ? x - w : x;
    return { x: left, y: y - size * 0.8, w, h: size };
  }

  // 重なりの検査。つないでいない箱を矢印が横切る、文字が箱や矢印に重なる、を落とす
  function check() {
    const all = [...boxes.values()];
    for (const ar of arrows) {
      for (let i = 1; i < ar.pts.length; i++) {
        const p = ar.pts[i - 1], q = ar.pts[i];
        const seg = { x: Math.min(p.x, q.x) - 1, y: Math.min(p.y, q.y) - 1, w: Math.abs(p.x - q.x) + 2, h: Math.abs(p.y - q.y) + 2 };
        for (const b of all) {
          if (ar.ends.includes(b.id)) continue;
          // 枠の中だけを通る線は container を横切ったことにしない
          if (b.container && inside(seg, b)) continue;
          if (b.container) {
            const innerEdge = !inside(seg, { x: b.x + 1, y: b.y + 1, w: b.w - 2, h: b.h - 2 });
            if (overlaps(seg, b) && innerEdge) errors.push(`矢印 ${ar.ends.join('→')} が箱 ${b.id} の枠を横切っている`);
            continue;
          }
          if (overlaps(seg, b)) errors.push(`矢印 ${ar.ends.join('→')} が箱 ${b.id} に重なっている`);
        }
      }
    }
    for (const t of measure ? texts : []) {
      const r = textRect(t);
      if (r.x < 0 || r.y < 0 || r.x + r.w > width || r.y + r.h > height) errors.push(`文字「${t.text}」が図の外にはみ出している`);
      for (const b of all) {
        if (b.container && inside(r, b)) continue;
        if (overlaps(r, b)) errors.push(`文字「${t.text}」が箱 ${b.id} に重なっている`);
      }
      for (const ar of arrows) {
        for (let i = 1; i < ar.pts.length; i++) {
          const p = ar.pts[i - 1], q = ar.pts[i];
          const seg = { x: Math.min(p.x, q.x) - 2, y: Math.min(p.y, q.y) - 2, w: Math.abs(p.x - q.x) + 4, h: Math.abs(p.y - q.y) + 4 };
          if (overlaps(r, seg)) errors.push(`文字「${t.text}」が矢印 ${ar.ends.join('→')} に重なっている`);
        }
      }
    }
    for (const b of measure ? all : []) {
      const titleW = measure(String(b.title), b.titleSize, b.container ? 700 : 600);
      if (!b.container && titleW > b.w - 16) errors.push(`箱 ${b.id} の見出しが箱の幅に収まらない（${Math.round(titleW)} / ${b.w - 16}）`);
      for (const s of b.sub) {
        const w = measure(s, 15, 400);
        if (w > b.w - 16) errors.push(`箱 ${b.id} の「${s}」が箱の幅に収まらない（${Math.round(w)} / ${b.w - 16}）`);
      }
    }
    if (errors.length) throw new Error(`図の検査に落ちた:\n  - ${errors.join('\n  - ')}`);
  }

  function head(tip, from, color) {
    const dx = Math.sign(tip.x - from.x), dy = Math.sign(tip.y - from.y);
    const bx = tip.x - dx * HEAD_LEN, by = tip.y - dy * HEAD_LEN;
    const px = -dy * HEAD_HALF, py = dx * HEAD_HALF;
    return `<polygon points="${tip.x},${tip.y} ${bx + px},${by + py} ${bx - px},${by - py}" fill="${color}"/>`;
  }

  function render() {
    check();
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">`);
    out.push(`  <!-- 生成物。直すときは同じ名前の .diagram.mjs を直して make writing-diagrams -->`);
    out.push(`  <rect width="${width}" height="${height}" fill="${background}"/>`);
    // 枠（container）を先に、中の箱を後に描く
    const ordered = [...boxes.values()].sort((a, b) => Number(b.container) - Number(a.container));
    for (const b of ordered) {
      const st = STYLES[b.style];
      out.push(`  <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${st.width}"/>`);
      if (b.container) {
        out.push(`  <text x="${b.x + 20}" y="${b.y + 32}" font-size="${b.titleSize}" font-weight="700" fill="${COLORS.title}">${esc(b.title)}</text>`);
        continue;
      }
      const cx = b.x + b.w / 2;
      const n = b.sub.length;
      const top = b.y + b.h / 2 - (n * 22) / 2 + 6;
      out.push(`  <text x="${cx}" y="${top}" text-anchor="middle" font-size="${b.titleSize}" font-weight="600" fill="${COLORS.title}">${esc(b.title)}</text>`);
      b.sub.forEach((s, i) => {
        out.push(`  <text x="${cx}" y="${top + 26 + i * 22}" text-anchor="middle" font-size="15" fill="${COLORS.sub}">${esc(s)}</text>`);
      });
    }
    for (const ar of arrows) {
      const color = COLORS[ar.color];
      const pts = ar.pts;
      // 線は矢じりの根元で止める（線の端が矢じりの先から飛び出さないように）
      const trim = (tip, prev) => ({
        x: tip.x - Math.sign(tip.x - prev.x) * HEAD_LEN,
        y: tip.y - Math.sign(tip.y - prev.y) * HEAD_LEN,
      });
      const linePts = pts.map((p) => ({ ...p }));
      linePts[linePts.length - 1] = trim(pts[pts.length - 1], pts[pts.length - 2]);
      if (ar.both) linePts[0] = trim(pts[0], pts[1]);
      const d = linePts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
      out.push(`  <path d="${d}" fill="none" stroke="${color}" stroke-width="2"${ar.dashed ? ' stroke-dasharray="7 5"' : ''}/>`);
      out.push(`  ${head(pts[pts.length - 1], pts[pts.length - 2], color)}`);
      if (ar.both) out.push(`  ${head(pts[0], pts[1], color)}`);
    }
    for (const t of texts) {
      out.push(`  <text x="${t.x}" y="${t.y}" text-anchor="${t.anchor}" font-size="${t.size}" fill="${COLORS[t.color]}">${esc(t.text)}</text>`);
    }
    out.push('</svg>');
    return out.join('\n') + '\n';
  }

  return { box, arrow, label, render };
}
