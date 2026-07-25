// 情報収集モード「Today's News」の日次フィード生成スクリプト。
// OpenAI Responses API + web_search ツールで「本命3・越境3」を収集し、
// アプリの JSON 契約(date / items[...]) に整形して docs/feed.json に書き出す。
// 定点観測(RSS)は初期は対象外(将来ここに追加する)。外部npm依存なし(Node 20 の組み込み fetch/crypto/fs を使用)。
//
// 必要な環境変数:
//   OPENAI_API_KEY        必須。OpenAI APIキー(GitHub Secrets 推奨)
//   OPENAI_MODEL          任意。既定 gpt-4o
//   OPENAI_WEBSEARCH_TYPE 任意。既定 web_search (エラー時は web_search_preview を試す)
//   FEED_OUT_FILE         任意。既定 docs/feed.json

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const WEBSEARCH_TYPE = process.env.OPENAI_WEBSEARCH_TYPE || 'web_search';
const OUT_FILE = process.env.FEED_OUT_FILE || path.join('docs', 'feed.json');
const STATE_FILE = path.join('state', 'seen.json');

if (!API_KEY) {
  console.error('ERROR: OPENAI_API_KEY is not set.');
  process.exit(1);
}

// --- 日付(JST) ---
const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
const dateStr = nowJst.toISOString().slice(0, 10);
const weekdayJp = ['日', '月', '火', '水', '木', '金', '土'][nowJst.getUTCDay()];

// --- 既出記録(重複回避はベストエフォート) ---
function loadSeen() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { urls: [], titles: [] };
  }
}
function saveSeen(seen) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(seen, null, 2));
}
const seen = loadSeen();
const seenUrls = new Set(seen.urls);
const recentTitles = seen.titles.slice(-20);

// --- プロンプト(memo.txt の方針: UX/体験設計とそれを支える事業・運用。業界軸・仕組み軸) ---
const prompt = `あなたはUXリサーチャー向けの記事キュレーターです。今日は${dateStr}(${weekdayJp})です。
Web検索を使い、次の2カテゴリで合計6件の実在する記事/Podcast/動画を選んでください。

【本命 (category: "honmei") 3件】
傑出した顧客体験・サービス体験の事例で、その体験を成立させているビジネスモデル・運用・組織・接客・設備・物流などの「仕組み」が具体的に分かるもの。

【越境 (category: "ekkyou") 3件】
普段のIT/UX界隈から少し離れた業界(医療・福祉・行政・教育・交通・物流・観光・ホテル・飲食・小売・金融・葬祭・スポーツ・エンタメ・地域コミュニティ 等)から、待ち時間・不安軽減・参加・接客・運用・オンラインと現地の接続などの体験設計が秀逸で、他業界にも転用できる示唆がある事例。業界が偏らないようにする。

【共通の選定条件】
- 単なる新商品/新機能の宣伝ではなく、利用者の体験が具体的に変わっている事例
- 第三者記事・ケーススタディ・インタビュー・利用者評価など根拠のあるもの
- 一般論・ハウツー・用語解説は除外
- なるべく最近の記事を優先。ただし傑出事例なら過去記事も可
- 同じ企業・業界・仕組みに偏らない
- 次の最近扱ったタイトルは避ける: ${recentTitles.length ? recentTitles.map((t) => `「${t}」`).join(' ') : '(なし)'}

【各記事の出力項目】
- category: "honmei" または "ekkyou"
- title: 記事タイトル(日本語。英語記事なら日本語に要約したタイトル)
- source: 媒体名/発信元(例: KESIKI note, 99% Invisible など)
- excerpt: 記事本文を転載せず、あなた自身の言葉で40〜80字の日本語要約
- industryTag: 業界を表す短い日本語タグ(例: 交通, 医療・福祉)
- mechanismTags: 体験を支える仕組みの短いタグを1〜2個(例: ["待ち時間の再設計"])
- format: "article" / "podcast" / "video" のいずれか
- estimatedMinutes: 推定所要時間(整数の分)
- url: 元記事の実在するURL

出力は説明文を一切付けず、次の形式のJSONのみ:
{"items":[{"category":"honmei","title":"...","source":"...","excerpt":"...","industryTag":"...","mechanismTags":["..."],"format":"article","estimatedMinutes":6,"url":"https://..."}]}`;

// --- OpenAI 呼び出し ---
async function callOpenAI(webSearchType) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      tools: [{ type: webSearchType }],
      input: prompt,
    }),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    const err = new Error(`OpenAI API ${res.status}: ${bodyText.slice(0, 800)}`);
    err.status = res.status;
    err.body = bodyText;
    throw err;
  }
  return JSON.parse(bodyText);
}

function extractText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const parts = [];
  for (const item of data.output ?? []) {
    for (const c of item.content ?? []) {
      if ((c.type === 'output_text' || c.type === 'text') && c.text) parts.push(c.text);
    }
  }
  return parts.join('\n');
}

function parseItems(text) {
  let t = (text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/[[{]/);
  if (start > 0) t = t.slice(start);
  const obj = JSON.parse(t);
  const items = Array.isArray(obj) ? obj : obj.items ?? [];
  return items;
}

function toId(seed) {
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

// --- 実行 ---
let data;
try {
  data = await callOpenAI(WEBSEARCH_TYPE);
} catch (e) {
  // web_search ツール名が非対応の場合は preview 版を再試行
  if (String(e.body || '').includes(WEBSEARCH_TYPE) && WEBSEARCH_TYPE === 'web_search') {
    console.warn('web_search が使えないため web_search_preview で再試行します');
    data = await callOpenAI('web_search_preview');
  } else {
    throw e;
  }
}

let rawItems;
try {
  rawItems = parseItems(extractText(data));
} catch (e) {
  console.error('JSONの解析に失敗しました:', e.message);
  console.error('応答(先頭500字):', extractText(data).slice(0, 500));
  process.exit(1);
}

const collected = [];
for (const raw of rawItems) {
  const title = String(raw.title || '').trim();
  if (!title) continue;
  const url = String(raw.url || '').trim();
  if (url && seenUrls.has(url)) continue; // 既出URLはスキップ(ベストエフォート)
  collected.push({
    id: toId(url || title),
    category: raw.category === 'ekkyou' ? 'ekkyou' : 'honmei',
    title,
    excerpt: String(raw.excerpt || '').slice(0, 120),
    source: String(raw.source || raw.sourceName || '').trim(),
    format: ['article', 'podcast', 'video'].includes(raw.format) ? raw.format : 'article',
    estimatedMinutes: Number.isFinite(Number(raw.estimatedMinutes)) ? Math.round(Number(raw.estimatedMinutes)) : 0,
    industryTag: String(raw.industryTag || '').trim(),
    mechanismTags: Array.isArray(raw.mechanismTags) ? raw.mechanismTags.map(String).slice(0, 2) : [],
    url,
  });
  if (url) seenUrls.add(url);
  seen.titles.push(title);
}

if (collected.length === 0) {
  console.error('新規の記事が0件でした。既存のfeed.jsonを維持します。');
  process.exit(1);
}

const feed = { date: dateStr, items: collected };
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(feed, null, 2) + '\n');

// 既出記録を更新(肥大化を防ぐため末尾300件に丸める)
seen.urls = Array.from(seenUrls).slice(-300);
seen.titles = seen.titles.slice(-300);
saveSeen(seen);

console.log(`OK: ${collected.length}件を ${OUT_FILE} に書き出しました (${dateStr})`);
