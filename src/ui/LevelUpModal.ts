import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { LOGICAL_WIDTH } from '../core/Viewport';
import type { PickChoice } from '../game/BuildSystem';

/**
 * レベルアップ時の3択UI。02_CORE_SPEC.md §7.4、§8「レベルアップ時はゲームを一時停止して3択UIを出す」。
 * 入力(タップ判定)は持たず、表示とhitTest()だけを担う受動的なview(main.ts側で
 * 既存のtoLogical変換+pointerdownハンドラを再利用してヒット判定する、既存のリトライタップと同じ設計)。
 */

// ユーザーフィードバック「レベルアップの3択の文字が小さくて見づらい」によりカード・文字を拡大した。
const CARD_WIDTH = 220;
const CARD_HEIGHT = 280;
const CARD_GAP = 20;
const CARD_Y = 400;

interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class LevelUpModal extends Container {
  private readonly cardGraphics: Graphics[] = [];
  private readonly cardKindText: Text[] = [];
  private readonly cardNameText: Text[] = [];
  private readonly cardDescText: Text[] = [];
  private cardRects: CardRect[] = [];

  constructor() {
    super();

    const dim = new Graphics().rect(0, 0, LOGICAL_WIDTH, 1280).fill({ color: 0x000000, alpha: 0.75 });
    this.addChild(dim);

    const titleText = new Text({
      text: 'LEVEL UP!',
      style: new TextStyle({ fill: '#ffe9a8', fontFamily: 'monospace', fontSize: 40, align: 'center' }),
    });
    titleText.anchor.set(0.5);
    titleText.x = LOGICAL_WIDTH / 2;
    titleText.y = 270;
    this.addChild(titleText);

    const totalWidth = CARD_WIDTH * 3 + CARD_GAP * 2;
    const startX = (LOGICAL_WIDTH - totalWidth) / 2;
    for (let i = 0; i < 3; i += 1) {
      const x = startX + i * (CARD_WIDTH + CARD_GAP);
      const g = new Graphics();
      g.x = x;
      g.y = CARD_Y;
      this.addChild(g);
      this.cardGraphics.push(g);

      const kindText = new Text({ text: '', style: new TextStyle({ fill: '#7fe8ff', fontFamily: 'monospace', fontSize: 17, align: 'center' }) });
      kindText.anchor.set(0.5, 0);
      kindText.x = x + CARD_WIDTH / 2;
      kindText.y = CARD_Y + 20;
      this.addChild(kindText);
      this.cardKindText.push(kindText);

      const nameText = new Text({
        text: '',
        style: new TextStyle({
          fill: '#ffffff',
          fontFamily: 'monospace',
          fontSize: 26,
          align: 'center',
          wordWrap: true,
          // 日本語には単語区切りの空白がなく、breakWordsがないとwordWrapが効かず
          // カード枠の外まで一直線にはみ出す(ユーザーフィードバックで発覚した不具合)。
          breakWords: true,
          wordWrapWidth: CARD_WIDTH - 20,
        }),
      });
      nameText.anchor.set(0.5, 0);
      nameText.x = x + CARD_WIDTH / 2;
      nameText.y = CARD_Y + 56;
      this.addChild(nameText);
      this.cardNameText.push(nameText);

      const descText = new Text({
        text: '',
        style: new TextStyle({
          fill: '#d8d8e0',
          fontFamily: 'monospace',
          fontSize: 21,
          align: 'center',
          wordWrap: true,
          breakWords: true,
          wordWrapWidth: CARD_WIDTH - 24,
        }),
      });
      descText.anchor.set(0.5, 0);
      descText.x = x + CARD_WIDTH / 2;
      descText.y = CARD_Y + 150;
      this.addChild(descText);
      this.cardDescText.push(descText);
    }

    this.visible = false;
  }

  show(choices: readonly PickChoice[]): void {
    this.cardRects = [];
    for (let i = 0; i < 3; i += 1) {
      const choice = choices[i];
      const visible = choice !== undefined;
      this.cardGraphics[i].visible = visible;
      this.cardKindText[i].visible = visible;
      this.cardNameText[i].visible = visible;
      this.cardDescText[i].visible = visible;
      if (!choice) continue;

      const color = choice.kind === 'module' ? 0x7fe8ff : 0xbfbf5f;
      this.cardGraphics[i].clear().roundRect(0, 0, CARD_WIDTH, CARD_HEIGHT, 12).fill({ color: 0x1a1020, alpha: 0.95 }).stroke({ width: 2, color });
      this.cardKindText[i].text = choice.kind === 'module' ? `モジュール Lv${choice.level}` : `チップ Lv${choice.level}`;
      this.cardNameText[i].text = choice.name;
      this.cardDescText[i].text = choice.description;
      this.cardRects.push({ x: this.cardGraphics[i].x, y: this.cardGraphics[i].y, width: CARD_WIDTH, height: CARD_HEIGHT });
    }
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  /** 論理座標(x,y)がどのカード(=表示中choicesの添字)に当たるかを返す。ヒットなしは-1 */
  hitTest(x: number, y: number): number {
    for (let i = 0; i < this.cardRects.length; i += 1) {
      const r = this.cardRects[i];
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return i;
    }
    return -1;
  }
}
