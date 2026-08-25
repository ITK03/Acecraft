# 開発環境: スマホ単体で開発できるか

> 作成日: 2026-08-25
> 背景: 「PCを使わず、スマホだけで開発できるのか」という問いへの回答。

---

## 決定（2026-08-25）

**端末は iPhone。したがって技術構成は TypeScript + PixiJS（Web）に確定。**
理由は本文の通りで、**iPhone 単体で回せる検証ループはブラウザしか存在しない**ため。
詳細な構成は [`04_TECH_STACK.md`](04_TECH_STACK.md) を参照。

---

## 結論

**できる。ただし Android か iPhone かで、取れる道が全く変わる。**

前提として、このプロジェクトでは**コードを書くのは Claude（クラウド上のコンテナ）**であり、
ユーザーがエディタを操作する必要はない。したがって本当に必要なのは以下の2つだけ：

1. **指示を出す手段** → Claude Code (web) をスマホのブラウザで開く。これは既に成立している
2. **ビルドを動かして手触りを確かめる手段** ← **ここだけが本当の制約**

「開発できるか」＝「**2 の検証ループがスマホだけで回るか**」という問題に還元される。

---

## 検証ループの選択肢

| # | 方式 | 1周の時間 | Android | iPhone | 備考 |
|---|---|---|---|---|---|
| **A** | Web ビルド → ブラウザで開く | **10〜30秒** | ◎ | ○〜△ | 最速。GitHub Pages 等に自動デプロイ |
| **B** | GitHub Actions で APK ビルド → 端末にインストール | 5〜10分 | ◎ | ✕ | 実機性能を正確に測れる |
| **C** | Godot Android エディタ + GABE で端末上ビルド | 1〜3分 | ○ | ✕ | 完全オフライン自己完結 |
| **D** | iOS 実機ビルド | — | — | ✕ | **Mac + Apple Developer Program が必須。スマホ単体では不可能** |

### A: Web ビルド（最有力）

- **TypeScript + PixiJS / Phaser** で作れば、iOS Safari / Android Chrome の**両方で確実に動く**
- GitHub Actions で自動ビルド → GitHub Pages にデプロイ → スマホでURLを開くだけ
- **Claude がコードを push した30秒後には、スマホで新しいビルドが遊べる**
- 最終的に **Capacitor** でネイティブアプリ化すればストア配信も可能
- 弱点: 大量の弾を描画したときの性能に**未検証のリスク**がある（後述）

### B: Godot + GitHub Actions で APK

- Godot はコマンドラインでヘッドレス書き出しができるため、CI で APK を自動生成できる
- 生成された APK を Android 端末にインストールして実機検証
- **Android 端末なら、これが最も「本番に近い」検証になる**
- iPhone では APK を入れられないため、この道は使えない

### C: Godot Android エディタ + GABE

- 2023年に Godot は Android 版エディタを追加
- **2026年、GABE（Godot Android Build Environment）が正式に安定版となり、
  Google Play で配布中。Gradle が端末上で完結し、スマホから直接ビルド・公開までできる**
- つまり「Android スマホ1台で、開発から公開まで完結する」は 2026 年現在、公式にサポートされた現実
- ただし本プロジェクトでは Claude がコードを書くため、端末上エディタの必要性は低い。
  **B があれば C は不要**

### 参考: Godot の Web 書き出しをスマホで使う場合の注意

- Godot 4 の Web 書き出しはマルチスレッド WASM を前提としており、**COOP/COEP ヘッダによる
  cross-origin isolation が必要**
- **Safari と Firefox for Android は `coep:credentialless` に未対応**のため、
  ホスティング先によっては動かない
- **Android Chrome は概ね良好。iOS Safari は不安定**
- → **iPhone で Web 検証したいなら、Godot ではなく TypeScript 系を選ぶべき**

---

## 推奨する進め方

### 端末が Android の場合

```
Phase 0  : Godot 4 + GitHub Actions で APK を自動ビルド（方式B）
Phase 1〜: そのまま Godot で継続
```

理由: 最終目標が「スタミナ + ガチャを含むフル実装」である以上、
ネイティブアプリになることは確定している。**最初からネイティブで作るのが最短距離**。
Android 端末があるなら、方式 B で実機検証しながら進められるので迂回する理由がない。

### 端末が iPhone の場合

```
Phase 0  : TypeScript + PixiJS で Web ビルド（方式A）→ ブラウザで手触り検証
Phase 1〜: 面白ければ Capacitor でネイティブ化、または Godot へ移植を検討
```

理由: iPhone では APK が使えず、iOS 実機ビルドには **Mac と Apple Developer Program（年間$99）が
どうしても必要**。この壁はスマホ単体では絶対に越えられない。
したがって **iPhone 単体で回せる検証ループはブラウザしかない**。

> **重要**: これは妥協ではない。Phase 0 の目的は「吸って撃つが気持ちいいか」の検証だけであり、
> ブラウザで十分に判定できる。**ストア配信は、面白いと確認できてから考えればよい問題**。

---

## Phase 0 の最初のタスク: 弾幕ストレステスト

**どの技術を選ぶにせよ、最初に書くコードはゲームではなくこれにする。**

第1次ドキュメントには「Web系は弾幕密度を再現しきれない可能性が高い」とあったが、
**これは検証されていない推測**である。WebGL のスプライトバッチングは数千枚の描画に耐えるため、
適切にプーリングすれば 600 発は十分現実的だと考えられる。**ただし断定はできない。**

だから測る。

```
[ ] 敵弾 600 + 自弾 400 = 計1000スプライトを同時に動かす
[ ] 全弾に 64px グリッドの衝突判定を通す
[ ] 実機（ユーザーのスマホ）のブラウザで開く
[ ] 60fps を維持できるか計測し、fps を画面に表示する
```

**判定**

| 結果 | 判断 |
|---|---|
| 安定して 60fps | **Web で確定。**iPhone でも Android でも同じ道を進める |
| 45〜60fps で揺れる | 描画方式を最適化して再測定（それでもダメなら Godot） |
| 45fps 未満 | Godot へ。iPhone の場合はストア配信を諦めるか、Mac の調達を検討する |

このテストは**半日で書けて、プロジェクト全体の技術選定を確定させる**。
最も費用対効果が高い最初の一手であり、ここを飛ばして本実装に入ってはいけない。

---

## スマホ単体では絶対にできないこと（正直に）

| 項目 | 理由 |
|---|---|
| **iOS アプリのビルド・配信** | Xcode が必要 = Mac が必須。回避策はクラウドMac(有料)のみ |
| Apple / Google のストア申請作業 | ブラウザでできなくはないが、審査対応は現実的に苦しい |
| 大量のアート制作 | 生成AIで下地は作れるが、調整作業は画面が小さすぎる |
| 長時間のバランス調整 | 数値をいじって遊ぶ、の反復はスマホだと苦行になる |

> ただし**これらはすべて Phase 0 の後の問題**であり、
> 「面白いかどうか」を確かめる段階では一切関係しない。
> **今この瞬間、スマホ1台で始められないことは何もない。**

---

## 出典

- Godot 公式: Using the Android editor — https://docs.godotengine.org/en/stable/tutorials/editor/using_the_android_editor.html
- Godot 公式: Creating games entirely on Android!（GABE 安定版） — https://godotengine.org/article/gabe-stable-release/
- Godot 公式: Web Export in 4.3 — https://godotengine.org/article/progress-report-web-export-in-4-3/
- Android Developers: Install Godot and configure projects for Android — https://developer.android.com/games/engines/godot/godot-configure
