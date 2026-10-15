#!/usr/bin/env node
// Zenn に初めて公開された記事を知らせる X の投稿文を下書きし、Discord に送る (.github/workflows/x-draft.yml)。
// 使い方: node scripts/x-draft.mjs <前のコミット> <今のコミット>
//
// - articles/*.md のうち、前のコミットで published: true ではなく、今 true のものを拾う
//   (Zenn は main への push で公開する。README「出し方」)
// - dev.to は make writing-devto で上げるので、そちら (devto.mjs) が送る
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { sendXDrafts } from './lib.mjs';

const ZENN_USER = 'nadai';
const [before, after] = process.argv.slice(2);
if (!after) {
  console.error('使い方: x-draft.mjs <前のコミット> <今のコミット>');
  process.exit(1);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
// 最初の push などで前のコミットが無いときは、全部を新しく出たものと見る
const hasBefore = /^[0-9a-f]{40}$/.test(before ?? '') && !/^0+$/.test(before);
const changed = hasBefore
  ? git('diff', '--name-only', '--diff-filter=AM', before, after, '--', 'articles/').split('\n')
  : git('ls-tree', '--name-only', after, 'articles/').split('\n');

/** そのコミットでの frontmatter。ファイルが無ければ空 */
function metaAt(commit, path) {
  try {
    const m = git('show', `${commit}:${path}`).match(/^---\n([\s\S]*?)\n---/);
    return (m && parse(m[1])) ?? {};
  } catch {
    return {}; // そのコミットには無かった
  }
}

for (const path of changed.filter((p) => /^articles\/[^/]+\.md$/.test(p))) {
  const meta = metaAt(after, path);
  if (meta.published !== true || (hasBefore && metaAt(before, path).published === true)) continue;
  const slug = path.replace(/^articles\/|\.md$/g, '');
  const url = `https://zenn.dev/${ZENN_USER}/articles/${slug}`;
  await sendXDrafts(`Zenn の記事 ${slug} (ja)`, [`Zennに記事を書きました。\n\n${meta.title}\n${url}`]);
}
