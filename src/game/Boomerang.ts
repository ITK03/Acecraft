import type { CraftState } from './Craft';
import type { BulletSystem } from './BulletSystem';

/**
 * mod_boomerang(ブーメラン)。02_CORE_SPEC.md §7.5「前方に飛び戻ってくる。背後の敵にも当たる」。
 * MainGunと同じ「周期クールダウンで自動発射」の構造。折り返し自体はBulletSystem.spawnBoomerangBullet/
 * turnBoomerangsが弾側の状態(turnTimer)で管理するため、ここでは発射だけを担当する。
 * interval<=0(未所持)の間は何もしない受動的なクラス。
 */
export interface BoomerangConfig {
  interval: number;
  damage: number;
  speed: number;
  turnSeconds: number;
  /** chip_targeting用。0〜1、発射時にダメージへ反映する */
  critChance: number;
  critDamageMultiplier: number;
}

export class Boomerang {
  private config: BoomerangConfig = { interval: 0, damage: 0, speed: 0, turnSeconds: 0, critChance: 0, critDamageMultiplier: 1 };
  private cooldown = 0;

  applyLoadout(config: BoomerangConfig): void {
    this.config = config;
  }

  update(dt: number, craftState: CraftState, craftX: number, craftY: number, bulletSystem: BulletSystem): void {
    if (this.config.interval <= 0) return; // 未所持
    if (craftState === 'DRAIN') return; // 主砲と同じく攻撃とドレインは排他(02_CORE_SPEC.md §2.1)

    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown += this.config.interval;

    const damage = Math.random() < this.config.critChance ? this.config.damage * this.config.critDamageMultiplier : this.config.damage;
    bulletSystem.spawnBoomerangBullet(craftX, craftY - 24, 0, -this.config.speed, damage, this.config.turnSeconds);
  }
}
