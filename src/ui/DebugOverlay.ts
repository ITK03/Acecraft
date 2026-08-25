import { Container, Text, TextStyle } from 'pixi.js';

/**
 * fps / 描画スプライト数 / アクティブ弾数 / 自機の状態名を常時表示するデバッグ表示。
 * 05_PHASE0_TASKS.md T0 の完了条件: 「全画面で fps が表示される」に対応。
 * 本番ビルドでは非表示にできるよう、setVisible を用意する。
 */
export interface DebugStats {
  fps: number;
  spriteCount: number;
  activeBullets: number;
  activeEnemies: number;
  craftState: string;
  craftCharge: number;
}

export class DebugOverlay extends Container {
  private readonly text: Text;
  private fpsAccumulatorFrames = 0;
  private fpsAccumulatorTime = 0;
  private fpsDisplay = 0;

  constructor() {
    super();
    const style = new TextStyle({
      fill: '#7fe8ff',
      fontFamily: 'monospace',
      fontSize: 14,
      lineHeight: 18,
    });
    this.text = new Text({ text: '', style });
    this.text.x = 8;
    this.text.y = 8;
    this.addChild(this.text);
  }

  /** レンダーごとに呼ぶ。1秒ごとに fps を再計算する */
  tick(rawFrameDeltaSeconds: number, stats: Omit<DebugStats, 'fps'>): void {
    this.fpsAccumulatorFrames += 1;
    this.fpsAccumulatorTime += rawFrameDeltaSeconds;
    if (this.fpsAccumulatorTime >= 1) {
      this.fpsDisplay = Math.round(this.fpsAccumulatorFrames / this.fpsAccumulatorTime);
      this.fpsAccumulatorFrames = 0;
      this.fpsAccumulatorTime = 0;
    }

    this.text.text =
      `fps: ${this.fpsDisplay}\n` +
      `sprites: ${stats.spriteCount}\n` +
      `bullets: ${stats.activeBullets}\n` +
      `enemies: ${stats.activeEnemies}\n` +
      `craft: ${stats.craftState} (charge ${stats.craftCharge})`;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
  }
}
