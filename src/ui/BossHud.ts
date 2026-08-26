import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { LOGICAL_WIDTH } from '../core/Viewport';

/**
 * ボスHPバー。02_CORE_SPEC.md §10 HUDレイアウト:
 * 「▓▓▓▓▓▓▓▓▓░░░░  ボスHP (ボス戦のみ)」。ボス戦中のみ表示する。
 */
export class BossHud extends Container {
  private readonly barBg: Graphics;
  private readonly barFill: Graphics;
  private readonly labelText: Text;
  private readonly barWidth = LOGICAL_WIDTH - 80;
  private readonly barHeight = 14;
  private readonly barX = 40;
  private readonly barY = 108;

  constructor() {
    super();
    this.barBg = new Graphics().rect(this.barX, this.barY, this.barWidth, this.barHeight).fill(0x2a1f3d);
    this.barFill = new Graphics();
    // マゼンタ(#FF3FA4)はチャージ弾専用の色相のため、HPバーは危険色の橙赤にする(T8 視認性ルール)。
    this.labelText = new Text({
      text: 'BOSS',
      style: new TextStyle({ fill: '#ff5a3c', fontFamily: 'monospace', fontSize: 14 }),
    });
    this.labelText.x = this.barX;
    this.labelText.y = this.barY - 18;

    this.addChild(this.barBg, this.barFill, this.labelText);
    this.visible = false;
  }

  update(hpRatio: number): void {
    this.visible = true;
    const t = Math.max(0, Math.min(1, hpRatio));
    this.barFill.clear().rect(this.barX, this.barY, this.barWidth * t, this.barHeight).fill(0xff5a3c);
  }

  hide(): void {
    this.visible = false;
  }
}
