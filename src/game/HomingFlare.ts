import type { CraftState } from './Craft';
import type { BulletSystem } from './BulletSystem';

/**
 * mod_homingflare(ホーミングフレア)。02_CORE_SPEC.md §7.5「敵を自動追尾する小弾を周期発射」。
 * MainGunと同じ「周期クールダウンで自動発射」の構造だが、発射した弾は追尾するため、
 * ホーミング方向の更新(steerFlareBullets)は main.ts 側で毎フレーム別途呼ぶ必要がある。
 * interval<=0(未所持)の間は何もしない受動的なクラス。
 */
export interface HomingFlareConfig {
  interval: number;
  damage: number;
  speed: number;
  /** chip_targeting用。0〜1、発射時にダメージへ反映する */
  critChance: number;
  critDamageMultiplier: number;
}

export class HomingFlare {
  private config: HomingFlareConfig = { interval: 0, damage: 0, speed: 0, critChance: 0, critDamageMultiplier: 1 };
  private cooldown = 0;

  applyLoadout(config: HomingFlareConfig): void {
    this.config = config;
  }

  update(dt: number, craftState: CraftState, craftX: number, craftY: number, bulletSystem: BulletSystem): void {
    if (this.config.interval <= 0) return; // 未所持
    if (craftState === 'DRAIN') return; // 主砲と同じく攻撃とドレインは排他(02_CORE_SPEC.md §2.1)

    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown += this.config.interval;
    const damage = Math.random() < this.config.critChance ? this.config.damage * this.config.critDamageMultiplier : this.config.damage;
    // 初速は上方向に撃ち出すだけ。曲げるのはsteerFlareBullets()の役割。
    bulletSystem.spawnFlareBullet(craftX, craftY - 24, 0, -this.config.speed, damage);
  }
}
