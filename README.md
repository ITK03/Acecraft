# Acecraft Clone Project

ACECRAFT 系（縦スクロール弾幕STG × ローグライト）ゲームの開発リポジトリ。

**方針: ゲームシステムは再現、名称・世界観・キャラクター・アセットは完全自作。**
詳細は `docs/01_RESEARCH.md` §10 を参照。

## ドキュメント

| ファイル | 内容 | 状態 |
|---|---|---|
| [`docs/01_RESEARCH.md`](docs/01_RESEARCH.md) | 原作リサーチ（第2次・詳細版）。信頼度ラベル付き | ✅ |
| [`docs/02_CORE_SPEC.md`](docs/02_CORE_SPEC.md) | コアゲームプレイ実装仕様。エンジン非依存 | ✅ |
| [`docs/03_DEV_ENVIRONMENT.md`](docs/03_DEV_ENVIRONMENT.md) | スマホ単体で開発できるか。検証ループの選択肢 | ✅ |
| [`docs/04_TECH_STACK.md`](docs/04_TECH_STACK.md) | 確定した技術構成、リポジトリ構成、iOS Safari 対策 | ✅ |
| [`docs/05_PHASE0_TASKS.md`](docs/05_PHASE0_TASKS.md) | Phase 0 タスク分解。実装担当はここから着手する | ✅ |
| `docs/06_META_SPEC.md` | メタ育成・スタミナ・ガチャ・サーバー仕様 | ⏳ Phase 2 着手前に作成 |

## 決定事項

| 項目 | 決定 |
|---|---|
| **スコープ** | 段階的にフル実装。まず最小構成、**最終的にスタミナとガチャは必ず実装する** |
| **キャラクター** | 原作とは完全に別物。オリジナルで作る |
| **アート** | Phase 0 は仮素材（幾何形状＋単色）。方向性は Phase 0 の合否が出てから |
| **開発端末** | iPhone |
| **技術構成** | **TypeScript + PixiJS v8 + Vite**（Web）→ 将来 Capacitor でネイティブ化 |
| **検証方法** | GitHub Actions → GitHub Pages → iPhone のホーム画面から起動 |

## 現在のフェーズ

**Phase 0 = プロトタイプ（未着手）**

目的は機能を揃えることではなく、**「吸って撃つ」が気持ちいいかを検証すること**。

次にやること: [`docs/05_PHASE0_TASKS.md`](docs/05_PHASE0_TASKS.md) の **T0 → T1** から。
T1（弾幕ストレステスト）は技術選定の引き返し地点であり、ここを飛ばして先に進まない。
