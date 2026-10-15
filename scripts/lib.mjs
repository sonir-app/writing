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

// ---- X の投稿文の下書き (Discord に送る。X には投稿しない。ワークスペースの docs/5_business/04-writing.md §8)

/** X の重み付きの長さ (twitter-text v3)。URL は23、下の範囲以外の字は2 */
export function xLength(text) {
  let n = 0;
  const rest = text.replace(/https?:\/\/\S+/g, () => {
    n += 23;
    return '';
  });
  for (const ch of rest.normalize('NFC')) {
    const o = ch.codePointAt(0);
    n += o <= 0x10ff || (o >= 0x2000 && o <= 0x200d) || (o >= 0x2010 && o <= 0x201f) || (o >= 0x2032 && o <= 0x2037) ? 1 : 2;
  }
  return n;
}

/**
 * 見出しのメッセージと、投稿文を1件ずつ別のメッセージで送る (「テキストをコピー」でそのまま X に貼れるように)。
 * Webhook は DISCORD_X_WEBHOOK_URL (手元は releasectl/.env、Actions は secret)。無ければ標準出力へ出すだけ
 */
export async function sendXDrafts(heading, posts) {
  const hook = process.env.DISCORD_X_WEBHOOK_URL;
  const post = async (content) => {
    if (!hook) return console.log(`${content}\n---`);
    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, flags: 4, allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) throw new Error(`Discord が ${res.status} を返した: ${await res.text()}`);
  };
  const lengths = posts.map((p) => `${xLength(p)}/280${xLength(p) > 280 ? ' ⚠️ 長すぎる' : ''}`).join(' / ');
  await post(`**X の下書き** ${heading} ${lengths}`);
  for (const p of posts) await post(p);
  console.log(hook ? `X の下書きを Discord に送った (${lengths})` : '(DISCORD_X_WEBHOOK_URL が無いので出しただけ)');
}
