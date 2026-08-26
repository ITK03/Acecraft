import { Container, Text, TextStyle } from 'pixi.js';
import { LOGICAL_WIDTH, LOGICAL_HEIGHT } from '../core/Viewport';

/**
 * ウェーブ番号・HP・残機の表示(05_PHASE0_TASKS.md T6「ウェーブ番号の表示」)。
 * ゲーム世界(論理座標、ビューポート倍率でスケールされる)側の HUD。
 * DebugOverlay(画面座標・開発者向け)とは別物で、こちらはプレイヤーに見せる本物のHUD。
 */
export class WaveHud extends Container {
  private readonly statusText: Text;
  private readonly resultText: Text;

  constructor() {
    super();

    this.statusText = new Text({
      text: '',
      style: new TextStyle({ fill: '#ffe9a8', fontFamily: 'monospace', fontSize: 18, align: 'right', lineHeight: 24 }),
    });
    this.statusText.anchor.set(1, 0);
    this.statusText.x = LOGICAL_WIDTH - 16;
    this.statusText.y = 16;
    this.addChild(this.statusText);

    this.resultText = new Text({
      text: '',
      style: new TextStyle({ fill: '#ffffff', fontFamily: 'monospace', fontSize: 36, align: 'center' }),
    });
    this.resultText.anchor.set(0.5);
    this.resultText.x = LOGICAL_WIDTH / 2;
    this.resultText.y = LOGICAL_HEIGHT / 2;
    this.resultText.visible = false;
    this.addChild(this.resultText);
  }

  update(waveNumber: number, totalWaves: number, hp: number, maxHp: number, lives: number): void {
    // 全ウェーブクリア後(ボス戦中)は waveNumber が totalWaves を超えうるので表示上は頭打ちにする
    const displayWave = Math.min(waveNumber, totalWaves);
    this.statusText.text = `WAVE ${displayWave}/${totalWaves}\nHP ${Math.max(0, Math.round(hp))}/${maxHp}\nLIVES ${lives}`;
  }

  showResult(status: 'cleared' | 'failed'): void {
    this.resultText.text = status === 'cleared' ? 'STAGE CLEAR\n(タップでリトライ)' : 'GAME OVER\n(タップでリトライ)';
    // マゼンタ(#FF3FA4)はチャージ弾専用の色相のため、失敗表示は危険色の橙赤にする(T8 視認性ルール)。
    this.resultText.style.fill = status === 'cleared' ? '#7fe8ff' : '#ff5a3c';
    this.resultText.visible = true;
  }
}
