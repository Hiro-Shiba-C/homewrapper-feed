# homewrapper-feed

Android Home Wrapper の情報収集モード「Today's News」に配信する日次フィード。
AIのWeb検索で「本命3・越境3」を収集し、`docs/feed.json` を GitHub Pages で公開する。
アプリ本体は別の非公開リポジトリで、このフィード（記事タイトル・要約・リンクのみ）だけを公開する。

- `collect.mjs` … 収集本体（OpenAI Responses API + web_search）。外部npm依存なし（Node 20）
- `.github/workflows/collect-news.yml` … 毎日 17:30 JST に実行し、結果をコミット
- `docs/feed.json` … 配信フィード（GitHub Pages で配信）
- `state/seen.json` … 既出記録（重複回避・ベストエフォート。自動更新）

※ 定点観測（RSS）は初期は対象外。将来 `collect.mjs` に追加する。

## セットアップ（初回のみ）

1. **このリポジトリを Public で作成**し、ここのファイル一式を push（下記コマンド参照）

2. **OpenAI APIキーを登録**
   - Settings → Secrets and variables → Actions → New repository secret
   - Name: `OPENAI_API_KEY` / Value: あなたのAPIキー
   - ※ ChatGPT Plus とは別に API 従量課金（1日1回で月 数百円〜数ドル見込み）

3. **GitHub Pages を有効化**
   - Settings → Pages → Source: **Deploy from a branch** → Branch: `main` / `/docs` → Save
   - 数分後、`https://<ユーザー名>.github.io/homewrapper-feed/feed.json` で配信される

4. **アプリに配信URLを設定**
   - アプリ側リポジトリの `app/src/main/java/com/homewrapper/news/NewsRepository.kt` の `FEED_URL` に上記URLを設定

5. **動作確認**
   - Actions → 「Collect UX news」→ Run workflow（手動実行）
   - 成功で `docs/feed.json` が更新され、Pages 経由でアプリが取得

## 手元での実行（任意）

```bash
OPENAI_API_KEY=sk-... node collect.mjs
```

## 調整ポイント

- 実行時刻: `.github/workflows/collect-news.yml` の `cron`
- モデル: ワークフローの `OPENAI_MODEL`（既定 `gpt-4o`）
- web検索ツール名がエラーになる場合: env に `OPENAI_WEBSEARCH_TYPE=web_search_preview`
- 収集方針（本命/越境の条件・業界・仕組み）: `collect.mjs` の `prompt`
