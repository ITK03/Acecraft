import { Container, Graphics } from 'pixi.js';
import type { CraftState } from './Craft';
import type { EnemySystem } from './EnemySystem';

/**
 * mod_strike_s(ピンポイントストライク)。02_CORE_SPEC.md §7.5「最もHPの高い敵に高威力の爆撃」。
 * 弾を介さず、周期タイマーで直接ダメージを与える単体ターゲット攻撃。命中位置に短命な
 * リング演出だけを出す。interval<=0(未所持)の間は何もしない受動的なクラス。
 */
export interface PinpointStrikeConfig {
  interval: number;
  damage: number;
}

const EFFECT_DURATION = 0.3;
// 敵撃破の輪(0xffe9a8)/ドレイン吸収の輪(白)と被らない色相として、爆撃らしい紅色を採用する。[設計値]
const EFFECT_COLOR = 0xff4d4d;

export class PinpointStrike {
  readonly view = new Container();
  private config: PinpointStrikeConfig = { interval: 0, damage: 0 };
  private cooldown = 0;
  private readonly ring = new Graphics();
  private ringLife = 0;
  private readonly targetScratch = { x: 0, y: 0 };

  constructor() {
    this.ring.circle(0, 0, 40).stroke({ width: 4, color: EFFECT_COLOR });
    this.ring.visible = false;
    this.view.addChild(this.ring);
  }

  applyLoadout(config: PinpointStrikeConfig): void {
    this.config = config;
  }

  update(dt: number, craftState: CraftState, enemySystem: EnemySystem): void {
    this.updateEffect(dt);
    if (this.config.interval <= 0) return; // 未所持
    if (craftState === 'DRAIN') return; // 主砲等と同じく攻撃とドレインは排他(02_CORE_SPEC.md §2.1)

    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown += this.config.interval;

    const index = enemySystem.findHighestHpActiveEnemy(this.targetScratch);
    if (index === -1) return; // 画面内に敵がいなければ何もせず、次のクールダウンを待つ
    enemySystem.applyDirectDamage(index, this.config.damage);
    this.ringLife = EFFECT_DURATION;
    this.ring.visible = true;
    this.ring.x = this.targetScratch.x;
    this.ring.y = this.targetScratch.y;
    this.ring.alpha = 1;
    this.ring.scale.set(0.3);
  }

  private updateEffect(dt: number): void {
    if (this.ringLife <= 0) return;
    this.ringLife -= dt;
    if (this.ringLife <= 0) {
      this.ring.visible = false;
      return;
    }
    const t = 1 - this.ringLife / EFFECT_DURATION;
    this.ring.scale.set(0.3 + t * 1.4);
    this.ring.alpha = 1 - t;
  }
}
