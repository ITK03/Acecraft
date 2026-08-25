import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { CraftState } from './Craft';

/**
 * クラフトの見た目。Phase 0 は仮素材(幾何形状+単色)。
 * 02_CORE_SPEC.md §2.3: 「コア位置には常時、視認できるインジケータ(小さな光点)を表示する」。
 * 状態(MOVE/DRAIN/COUNTER)に応じて機体色を変え、開発中の状態確認をしやすくする
 * (本番では削る/差し替える想定の仮実装)。
 */
export class CraftView extends Container {
  private readonly body: Graphics;
  private readonly core: Graphics;
  private readonly chargeRing: Graphics;
  private readonly stateLabel: Text;
  private readonly bodyRadius: number;

  constructor(hitRadius: number, bodyRadius = 40) {
    super();
    this.bodyRadius = bodyRadius;

    this.body = new Graphics();
    this.addChild(this.body);

    this.core = new Graphics().circle(0, 0, hitRadius).fill(0xffffff);
    this.addChild(this.core);

    this.chargeRing = new Graphics();
    this.addChild(this.chargeRing);

    this.stateLabel = new Text({
      text: '',
      style: new TextStyle({ fill: '#ffffff', fontFamily: 'monospace', fontSize: 12, align: 'center' }),
    });
    this.stateLabel.anchor.set(0.5, 0);
    this.stateLabel.y = bodyRadius + 8;
    this.addChild(this.stateLabel);

    this.setState('DRAIN');
  }

  setState(state: CraftState): void {
    const color = state === 'MOVE' ? 0x7fe8ff : state === 'COUNTER' ? 0xff3fa4 : 0x8f7fbf;
    this.body.clear().poly([0, -this.bodyRadius, this.bodyRadius * 0.75, this.bodyRadius, -this.bodyRadius * 0.75, this.bodyRadius]).fill(color).stroke({ width: 2, color: 0x1a1020 });
    this.stateLabel.text = state;
  }

  /** 02_CORE_SPEC.md §3.5: 「自機周囲に光の輪。charge に比例して太く・明るく」 */
  setCharge(charge: number, chargeMax: number): void {
    this.chargeRing.clear();
    if (charge <= 0) return;
    const t = Math.max(0, Math.min(1, charge / chargeMax));
    const ringRadius = this.bodyRadius + 8 + t * 28;
    this.chargeRing.circle(0, 0, ringRadius).stroke({ width: 3 + t * 4, color: 0xff3fa4, alpha: 0.35 + t * 0.55 });
  }
}
