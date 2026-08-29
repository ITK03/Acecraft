import type { CraftState } from './Craft';
import type { BulletSystem } from './BulletSystem';

/**
 * mod_bouncer(バウンサー)。02_CORE_SPEC.md §7.5「敵から敵へ跳ね返る弾。単体には強いが多数には弱い」。
 * MainGunと同じ「周期クールダウンで自動発射」の構造。跳ね返り自体はEnemySystem.resolvePlayerBulletHits
 * (命中のたびに次の的を探してBulletSystem.bounceBulletを呼ぶ)が担うため、ここでは発射だけを行う。
 * interval<=0(未所持)の間は何もしない受動的なクラス。
 */
export interface BouncerConfig {
  interval: number;
  damage: number;
  speed: number;
  maxBounces: number;
  /** chip_targeting用。0〜1、発射時にダメージへ反映する */
  critChance: number;
  critDamageMultiplier: number;
}

export class Bouncer {
  private config: BouncerConfig = { interval: 0, damage: 0, speed: 0, maxBounces: 0, critChance: 0, critDamageMultiplier: 1 };
  private cooldown = 0;

  applyLoadout(config: BouncerConfig): void {
    this.config = config;
  }

  update(dt: number, craftState: CraftState, craftX: number, craftY: number, bulletSystem: BulletSystem): void {
    if (this.config.interval <= 0) return; // 未所持
    if (craftState === 'DRAIN') return; // 主砲と同じく攻撃とドレインは排他(02_CORE_SPEC.md §2.1)

    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown += this.config.interval;

    const damage = Math.random() < this.config.critChance ? this.config.damage * this.config.critDamageMultiplier : this.config.damage;
    bulletSystem.spawnBouncerBullet(craftX, craftY - 24, 0, -this.config.speed, damage, this.config.maxBounces);
  }
}
