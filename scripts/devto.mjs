#!/usr/bin/env node
// en/<slug>.md を dev.to に上げる。初回は作成、2回目からは同じ記事を更新する。
// 使い方: DEVTO_API_KEY=... node scripts/devto.mjs <slug>
//
// - 公開するかは frontmatter の published で決める（Zenn と同じ。既定は下書き）
// - 本文の /images/... は公開リポジトリの raw URL に書き換える。画像は先に main へ push しておく
// - 記事の id は en/.devto.json に控える（同じ記事を2本作らないため）。このファイルもコミットする
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { requireSlug, readDoc, RAW_BASE } from './lib.mjs';

const slug = requireSlug(process.argv[2]);
const key = process.env.DEVTO_API_KEY;
if (!key) {
  console.error('DEVTO_API_KEY が無い（releasectl/.env に書く。https://dev.to/settings/extensions で発行）');
  process.exit(1);
}

const { meta, body } = readDoc(`en/${slug}.md`);
if (!meta.title) {
  console.error(`en/${slug}.md の title が空`);
  process.exit(1);
}

const article = {
  title: meta.title,
  body_markdown: body.replaceAll('](/images/', `](${RAW_BASE}/images/`),
  published: meta.published === true,
  tags: meta.tags ?? [],
};
if (meta.series) article.series = meta.series;
if (meta.cover_image) article.main_image = meta.cover_image.replace(/^\/images\//, `${RAW_BASE}/images/`);
if (meta.canonical_url) article.canonical_url = meta.canonical_url;
if (article.tags.length > 4) {
  console.error('dev.to の tags は4つまで');
  process.exit(1);
}

const idsPath = 'en/.devto.json';
const ids = existsSync(idsPath) ? JSON.parse(readFileSync(idsPath, 'utf8')) : {};
const id = ids[slug];

const res = await fetch(id ? `https://dev.to/api/articles/${id}` : 'https://dev.to/api/articles', {
  method: id ? 'PUT' : 'POST',
  headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/vnd.forem.api-v1+json' },
  body: JSON.stringify({ article }),
});
if (!res.ok) {
  console.error(`dev.to が ${res.status} を返した: ${await res.text()}`);
  process.exit(1);
}
const out = await res.json();
if (!id) {
  ids[slug] = out.id;
  writeFileSync(idsPath, JSON.stringify(ids, null, 2) + '\n');
}
console.log(`${id ? 'updated' : 'created'} ${article.published ? '(公開)' : '(下書き)'} ${out.url}`);
