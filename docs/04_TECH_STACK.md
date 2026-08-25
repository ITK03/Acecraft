# 技術構成と開発フロー

> 決定日: 2026-08-25
> 前提: 開発・検証端末は **iPhone**。`03_DEV_ENVIRONMENT.md` の分岐に従い Web 構成を採用。

---

## 1. 確定した構成

| レイヤー | 採用 | 理由 |
|---|---|---|
| 言語 | **TypeScript** | 型があると Sonnet の実装精度が上がる。仕様書のスキーマをそのまま型にできる |
| 描画 | **PixiJS v8**（WebGL2 / WebGPU） | スプライトバッチングが強く、弾幕の大量描画に最適。2D特化で余計な重さがない |
| ビルド | **Vite** | 起動が速い。設定がほぼ不要 |
| ゲームループ | **自作**（固定ステップ） | エンジンのループに乗らない。`02_CORE_SPEC.md` §1 の要件を満たすため |
| インゲームUI | PixiJS 上に描画 | HUD は指の操作を邪魔しない位置に置く必要があり、ゲーム座標系で扱いたい |
| アウトゲームUI | **DOM + CSS**（Phase 2 で判断） | ガチャ・編成・ショップ等はスクロールや入力が多く、DOM の方が圧倒的に速く作れる |
| セーブ | Phase 0/1: `localStorage` → Phase 2: **Supabase** | アカウント・ガチャ履歴・課金検証はサーバー必須 |
| 配信（検証） | **GitHub Actions → GitHub Pages** | push から30秒で iPhone のブラウザに届く |
| 配信（製品） | **Capacitor** でネイティブ化 | Web資産をそのままストアアプリにできる |

### なぜ PixiJS か（Phaser ではなく）

Phaser はゲームエンジンとして機能が揃っているが、本作は
「**固定ステップ・完全プーリング・独自の衝突グリッド**」という要件が最初から決まっている。
エンジンの流儀に合わせる労力より、**描画だけを PixiJS に任せて残りを自作する方が制御しやすい**。
弾幕STGは性能がすべてなので、内部で何が起きているか分からない層を挟まない。

---

## 2. リポジトリ構成

```
/
├─ docs/                      仕様書（既存）
├─ index.html
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ public/
│   ├─ manifest.webmanifest   PWA（iPhone のホーム画面に追加するため）
│   └─ assets/                Phase 0 は空でよい（仮素材はコード生成）
├─ src/
│   ├─ main.ts                エントリ。Pixi 初期化、ループ起動
│   ├─ core/
│   │   ├─ Loop.ts            固定ステップループ（アキュムレータ方式）
│   │   ├─ Pool.ts            汎用オブジェクトプール
│   │   ├─ SpatialGrid.ts     64px ユニフォームグリッド衝突
│   │   ├─ Input.ts           タッチ入力の正規化（後述の iOS 対策を含む）
│   │   └─ Rng.ts             シード可能な乱数（リプレイ・検証のため必須）
│   ├─ game/
│   │   ├─ Craft.ts           自機の状態機械 MOVE / DRAIN / COUNTER
│   │   ├─ DrainField.ts      吸引判定と演出
│   │   ├─ BulletSystem.ts
│   │   ├─ EnemySystem.ts
│   │   ├─ WaveDirector.ts
│   │   ├─ BossController.ts
│   │   ├─ LootSystem.ts
│   │   └─ BuildSystem.ts     モジュール/チップのスロット・進化・3択
│   ├─ data/
│   │   ├─ balance.json       ★全パラメータを外出し（02_CORE_SPEC.md §13）
│   │   ├─ modules.json
│   │   ├─ chips.json
│   │   ├─ enemies.json
│   │   └─ stages/1-1.json
│   ├─ ui/
│   │   ├─ Hud.ts
│   │   ├─ LevelUpModal.ts
│   │   └─ DebugOverlay.ts    ★fps / 弾数 / 状態を常時表示
│   └─ types/                 仕様書のスキーマをそのまま型定義に
└─ .github/workflows/deploy.yml
```

---

## 3. iPhone / iOS Safari で必ず踏む地雷（実装前に読むこと）

**これらは「後で直す」ではなく、最初から入れておかないと手触りの検証自体が成立しない。**

| # | 問題 | 対策 |
|---|---|---|
| 1 | ドラッグでページがスクロール／バウンドする | `body { overscroll-behavior: none; }` かつキャンバスに `touch-action: none`。`touchmove` で `preventDefault()`（リスナは `{ passive: false }`） |
| 2 | ダブルタップでズームする | `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">` |
| 3 | 長押しでテキスト選択・コンテキストメニューが出る | `user-select: none; -webkit-touch-callout: none;` |
| 4 | **音がまったく鳴らない** | iOS は**ユーザー操作を起点にしないと AudioContext が動かない**。タイトルの「タップして開始」で `AudioContext.resume()` を呼ぶ。これを忘れると「無音のプロトタイプ」で手触りを誤判定する |
| 5 | ノッチ／ホームインジケータにUIが隠れる | `env(safe-area-inset-*)` を使い、HUD を安全領域内に配置 |
| 6 | リフレッシュレートが 60Hz とは限らない | **`requestAnimationFrame` の間隔を信用しない。** 必ずアキュムレータで固定ステップに落とす（`02_CORE_SPEC.md` §1） |
| 7 | アプリ切り替えで復帰したとき大量に時間が進む | `document.visibilitychange` でポーズ。`deltaTime` は 0.25 秒で上限クランプ |
| 8 | Safari の URL バーで表示領域が変動する | `100vh` を使わない。`window.innerHeight` を `resize` で拾い直すか `100dvh` |
| 9 | ホーム画面に追加すると全画面になる | PWA manifest に `"display": "standalone"`。**検証はホーム画面から起動すること**（Safari の UI が消え、実際の遊び心地に近づく） |
| 10 | 発熱でクロックが落ち、後半だけ重くなる | 5分間の連続稼働で fps を計測する。初動の数値だけ見て判断しない |

---

## 4. デプロイフロー

```
Claude が push
   ↓
GitHub Actions: npm ci → npm run build → GitHub Pages へデプロイ
   ↓
iPhone で https://itk03.github.io/Acecraft/ を開く（ホーム画面に追加済み）
   ↓
遊ぶ → フィードバックを Claude に伝える
```

- 所要時間: push から **およそ 30〜60 秒**
- **キャッシュ対策必須**: iOS Safari は古いビルドを掴んで離さないことがある。
  ビルド成果物にハッシュ付きファイル名を使い、Service Worker は Phase 0 では**入れない**
  （オフライン対応より、常に最新が出ることを優先する）

---

## 5. 製品化の道筋（今は着手しない、把握だけしておく）

| 配信先 | 必要なもの | スマホ単体で可能か |
|---|---|---|
| **Web（ブラウザ）** | GitHub Pages 等 | ✅ 可能。今すぐできる |
| **Google Play** | Capacitor + Android ビルド（CI可）+ 開発者登録 $25（一度きき） | ✅ 実質可能（ビルドは GitHub Actions が行う） |
| **App Store** | Capacitor + **Xcode = Mac が必須** + Apple Developer Program 年 $99 | ❌ **不可能** |

> **正直に言っておくべきこと**: iPhone しか持っていない状態で、iOS 版を App Store に出すことはできない。
> Mac（またはクラウドMac）がどこかの時点で必要になる。
> ただし **Web 版と Android 版はスマホ単体で完成・公開まで到達できる**。
> そして Phase 0 の目的（面白いかの判定）には、そもそも一切関係しない。

---

## 6. スタミナ・ガチャを見据えた注意（Phase 2 の前提）

最終的にスタミナとガチャを実装することが決まっているため、**Phase 1 の時点で以下を守っておく**。
後から直すと作り直しになる箇所。

1. **時刻をクライアントの `Date.now()` で判定しない**
   スタミナ回復もログインボーナスも、端末時計を進めれば破られる。
   Phase 1 では `localStorage` でよいが、**時刻取得を1つの関数に集約**しておき、
   Phase 2 でサーバー時刻に差し替えられるようにする
2. **乱数を1つのシード可能な `Rng` に集約する**
   ガチャの抽選は必ずサーバー側に移す。`Math.random()` を各所に散らさない
3. **プレイヤーの所持データを1つのストアに集約する**
   通貨・所持キャラ・ステージ進行を各画面が直接触ると、サーバー同期時に破綻する
4. **確率表示は法令上の必須要件**（日本のガチャ）。データ構造に排出率を持たせておく

---

## 7. 次にやること

`05_PHASE0_TASKS.md` の順に実装する。**最初のタスクは弾幕ストレステストであり、ゲームではない。**
