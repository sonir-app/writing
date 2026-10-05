#!/usr/bin/env node
// 1本分の原稿（Zenn・dev.to・Show HN）と画像の置き場所を作る。
// 使い方: node scripts/new.mjs <slug>
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { requireSlug } from './lib.mjs';

const slug = requireSlug(process.argv[2]);

const files = {
  [`articles/${slug}.md`]: `---
title: ""
emoji: "🔊"
type: "tech"
topics: ["rust", "audio", "macos"]
published: false
---

## はじめに

---

Sonir Bench: https://sonir.app
作者: https://nadai.dev
`,
  [`en/${slug}.md`]: `---
title: ""
published: false
tags: [rust, audio, macos, dsp]
series: ""
---

## Introduction

---

Sonir Bench: https://sonir.app
Author: https://nadai.dev
`,
  [`hn/${slug}.md`]: `---
title: "Show HN: "
url: "https://sonir.app"
---

<!-- 投稿の直後に自分で付ける最初のコメント。何を作ったか、なぜ作ったか、技術的に面白いところ -->
`,
};

for (const [path, body] of Object.entries(files)) {
  if (existsSync(path)) {
    console.log(`skip    ${path}（もうある）`);
    continue;
  }
  writeFileSync(path, body);
  console.log(`created ${path}`);
}
mkdirSync(`images/${slug}`, { recursive: true });
console.log(`created images/${slug}/`);
