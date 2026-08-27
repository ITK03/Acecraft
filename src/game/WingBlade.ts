import { Container, Graphics } from 'pixi.js';
import type { CraftState } from './Craft';
import type { EnemySystem } from './EnemySystem';

/**
 * mod_blade(ウイングブレード)。02_CORE_SPEC.md §7.5「機体至近を薙ぐ近接攻撃」。
 * MainGun等と同じくMOVE/COUNTER中のみ有効(DRAIN中は撃たない)。周期タイマーで
 * 自機を中心にした範囲へ直接ダメージを与える(弾を介さない)。interval<=0(未所持)の間は
 * 何もしない受動的なクラス。
 */
export interface WingBladeConfig {
  interval: number;
  radius: number;
  damage: number;
  /** chip_targeting用。0〜1、発動時にダメージへ反映する */
  critChance: number;
  critDamageMultiplier: number;
}

const EFFECT_DURATION = 0.25;
// 敵撃破の輪(暖色)/ストライクの紅色/レーザーの水色と被らない色相として白系を採用する
// (自機由来の力という点でオービットと同系統だが、輪の太さで区別する)。[設計値]
const EFFECT_COLOR = 0xdff2ff;

export class WingBlade {
  readonly view = new Container();
  private config: WingBladeConfig = { interval: 0, radius: 0, damage: 0, critChance: 0, critDamageMultiplier: 1 };
  private cooldown = 0;
  private readonly ring = new Graphics();
  private ringLife = 0;
  private ringRadius = 0;

  constructor() {
    this.ring.visible = false;
    this.view.addChild(this.ring);
  }

  applyLoadout(config: WingBladeConfig): void {
    this.config = config;
  }

  update(dt: number, craftState: CraftState, craftX: number, craftY: number, enemySystem: EnemySystem): void {
    this.updateEffect(dt);
    if (this.config.interval <= 0) return; // 未所持
    if (craftState === 'DRAIN') return; // 攻撃とドレインは排他(02_CORE_SPEC.md §2.1)

    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown += this.config.interval;

    const damage = Math.random() < this.config.critChance ? this.config.damage * this.config.critDamageMultiplier : this.config.damage;
    enemySystem.applyRadiusDamage(craftX, craftY, this.config.radius, damage);

    this.ringLife = EFFECT_DURATION;
    this.ringRadius = this.config.radius;
    this.ring.visible = true;
    this.ring.x = craftX;
    this.ring.y = craftY;
    this.ring.alpha = 1;
  }

  private updateEffect(dt: number): void {
    if (this.ringLife <= 0) return;
    this.ringLife -= dt;
    if (this.ringLife <= 0) {
      this.ring.visible = false;
      return;
    }
    const t = 1 - this.ringLife / EFFECT_DURATION;
    this.ring.clear().circle(0, 0, this.ringRadius * (0.4 + t * 0.6)).stroke({ width: 4, color: EFFECT_COLOR, alpha: 1 - t });
  }
}
