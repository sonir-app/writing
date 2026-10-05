# Sonir の技術記事

Sonir（Bench / Remote）の技術記事を、Zenn（日本語）・dev.to（英語）・Show HN の3か所へ出すための原稿置き場。方針と題材は非公開のワークスペース側（`docs/5_business/04-writing.md`）で管理する。

## 置き方

```
articles/<slug>.md   Zenn（日本語）。このリポジトリは Zenn と GitHub 連携している
en/<slug>.md         dev.to（英語）
en/.devto.json       dev.to の記事 id（slug → id）。スクリプトが書く。コミットする
hn/<slug>.md         Show HN の投稿（タイトル・URL・最初のコメント）
images/<slug>/       図。Zenn と dev.to の両方から使う
books/               Zenn の本（今は使わない）
images/<slug>/*.diagram.mjs  図の元（.svg / .png はここから組む生成物）
scripts/             下の make が呼ぶもの
```

1本の題材は同じ slug で3か所に置く（`make writing-new SLUG=...` で一式できる）。slug は Zenn の制約 `^[a-z0-9_-]{12,50}$` に合わせる。

## 出し方

コマンドはワークスペース直下の `make` から叩く（`make help` の `writing-*`）。

| 出す先 | 手順 |
|---|---|
| Zenn | `make writing-preview` で確かめる → `published: true` にして `main` に push すると公開される |
| dev.to | `make writing-devto SLUG=...`。初回は作成、2回目からは同じ記事を更新する。公開は frontmatter の `published` で決まる |
| Show HN | `make writing-hn SLUG=...`。投稿画面が埋まった状態で開き、最初のコメントがクリップボードに入る。送信とコメントは手で |

- **図（箱と矢印）は SVG を手で書かない。** `images/<slug>/<name>.diagram.mjs` に箱と矢印を並べ、`make writing-diagrams` で `<name>.svg` と `<name>.png` を組む（部品は `scripts/diagram.mjs`）。矢印は箱の辺から自動で離れ、矢じりも揃う。矢印が他の箱を横切る・文字が箱や矢印に重なる・文字が箱に収まらない・斜めの矢印、はどれも組む時点で落ちる
- 組んだ図は必ず PNG を開いて目でも確かめる。検査が見るのは重なりと収まりだけで、配置の良し悪しは見ない
- 本文からは `![](/images/<slug>/<name>.png)` で参照する（Zenn は SVG を配信しない）。画面写真（WebP）はそのまま置いてよい
- `make writing-check` は、`images/` の SVG がすべて `.diagram.mjs` から組んだもので、組み直した結果と一致するかを見る。push のたびに GitHub Actions でも同じ検査が走り、`make writing-devto` も送る前に通す
- dev.to には `/images/...` を `raw.githubusercontent.com` の URL に書き換えて送る。**画像は dev.to に送る前に `main` へ push しておく**
- dev.to の API キーは `releasectl/.env`（ワークスペース側、追跡しない）の `DEVTO_API_KEY`。このリポジトリは公開なので、鍵はここに置かない

## 注意

- **公開リポジトリ。** 下書き（`published: false`）も誰でも読める
- `main` に直接コミットする（ブランチも PR も作らない）
- Zenn の `published: true` は push した時点で公開される。戻すには `false` にして push する
