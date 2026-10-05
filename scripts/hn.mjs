#!/usr/bin/env node
// hn/<slug>.md から Show HN の投稿画面を開き、最初のコメントをクリップボードに入れる。
// HN には投稿の API が無いので、送信と最初のコメントは手で行う。
// 使い方: node scripts/hn.mjs <slug>
import { execFileSync } from 'node:child_process';
import { requireSlug, readDoc } from './lib.mjs';

const slug = requireSlug(process.argv[2]);
const { meta, body } = readDoc(`hn/${slug}.md`);

const title = String(meta.title ?? '').trim();
const url = String(meta.url ?? '').trim();
const comment = body.replace(/<!--[\s\S]*?-->/g, '').trim();

const errors = [];
if (!title.startsWith('Show HN: ') || title === 'Show HN:') errors.push('title は "Show HN: " で始める');
if (title.length > 80) errors.push(`title は80字まで（いま ${title.length} 字）`);
if (!/^https?:\/\//.test(url)) errors.push('url が無い');
if (!comment) errors.push('最初のコメント（本文）が空');
if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}

execFileSync('pbcopy', { input: comment });
const submit = `https://news.ycombinator.com/submitlink?u=${encodeURIComponent(url)}&t=${encodeURIComponent(title)}`;
execFileSync('open', [submit]);
console.log(`開いた: ${submit}`);
console.log('最初のコメントはクリップボードに入れた。投稿したら、その投稿のページに貼る');
