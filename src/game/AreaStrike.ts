import { Container, Graphics } from 'pixi.js';
import { LOGICAL_WIDTH, LOGICAL_HEIGHT } from '../core/Viewport';
import type { CraftState } from './Craft';
import type { EnemySystem } from './EnemySystem';

/**
 * mod_strike_a(エリアストライク)。02_CORE_SPEC.md §7.5「ランダム地点に範囲爆撃」。
 * MainGunと同じくMOVE/COUNTER中のみ有効(DRAIN中は撃たない)。周期タイマーで画面内の
 * ランダムな座標へ範囲ダメージを与える。interval<=0(未所持)の間は何もしない受動的なクラス。
 */
export interface AreaStrikeConfig {
  interval: number;
  radius: number;
  damage: number;
  /** chip_targeting用。0〜1、発動時にダメージへ反映する */
  critChance: number;
  critDamageMultiplier: number;
}

const EFFECT_DURATION = 0.35;
// 敵撃破の輪(暖色)/ストライクSの紅色/ブレードの白と被らない色相として黄色を採用する。[設計値]
const EFFECT_COLOR = 0xffe066;
// 画面端すぎる位置を避けるための余白。[設計値]
const EDGE_MARGIN = 60;

export class AreaStrike {
  readonly view = new Container();
  private config: AreaStrikeConfig = { interval: 0, radius: 0, damage: 0, critChance: 0, critDamageMultiplier: 1 };
  private cooldown = 0;
  private readonly ring = new Graphics();
  private ringLife = 0;
  private ringRadius = 0;

  constructor() {
    this.ring.visible = false;
    this.view.addChild(this.ring);
  }

  applyLoadout(config: AreaStrikeConfig): void {
    this.config = config;
  }

  update(dt: number, craftState: CraftState, enemySystem: EnemySystem): void {
    this.updateEffect(dt);
    if (this.config.interval <= 0) return; // 未所持
    if (craftState === 'DRAIN') return; // 攻撃とドレインは排他(02_CORE_SPEC.md §2.1)

    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown += this.config.interval;

    const x = EDGE_MARGIN + Math.random() * (LOGICAL_WIDTH - EDGE_MARGIN * 2);
    const y = EDGE_MARGIN + Math.random() * (LOGICAL_HEIGHT - EDGE_MARGIN * 2);
    const damage = Math.random() < this.config.critChance ? this.config.damage * this.config.critDamageMultiplier : this.config.damage;
    enemySystem.applyRadiusDamage(x, y, this.config.radius, damage);

    this.ringLife = EFFECT_DURATION;
    this.ringRadius = this.config.radius;
    this.ring.visible = true;
    this.ring.x = x;
    this.ring.y = y;
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
    this.ring.clear().circle(0, 0, this.ringRadius * (0.3 + t * 0.7)).stroke({ width: 4, color: EFFECT_COLOR, alpha: 1 - t });
  }
}
