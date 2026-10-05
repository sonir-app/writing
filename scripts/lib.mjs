// 3つの置き場所（Zenn / dev.to / Show HN）の原稿で共通に使う読み書き。
import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';

// Zenn の slug の制約。日本語版・英語版・HN の原稿で同じ slug を使う
export const SLUG_RE = /^[a-z0-9_-]{12,50}$/;

// 公開リポジトリの画像の置き場所。dev.to は外から読める URL の画像しか出せない
export const RAW_BASE = 'https://raw.githubusercontent.com/sonir-app/writing/main';

export function requireSlug(slug) {
  if (!slug || !SLUG_RE.test(slug)) {
    console.error(`slug は ${SLUG_RE} に合わせる（受け取った値: ${slug ?? '(無し)'}）`);
    process.exit(1);
  }
  return slug;
}

// `---` で挟んだ frontmatter と本文に分ける
export function readDoc(path) {
  if (!existsSync(path)) {
    console.error(`${path} が無い（make writing-new SLUG=... で作る）`);
    process.exit(1);
  }
  const text = readFileSync(path, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) {
    console.error(`${path} に frontmatter が無い`);
    process.exit(1);
  }
  return { meta: parse(m[1]) ?? {}, body: m[2] };
}
