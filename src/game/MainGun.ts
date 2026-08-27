import type { CraftState } from './Craft';
import type { BulletSystem } from './BulletSystem';

/**
 * 主砲の自動連射。02_CORE_SPEC.md §2.4「主砲(MOVE / COUNTER 中のみ発射)」。
 * DRAIN 中はクールダウンを進めず、撃たない(貯めもしない: 再開時にいきなり連射されないよう
 * クールダウンは DRAIN 中も維持したまま止めるだけ)。
 */
export interface MainGunConfig {
  fireInterval: number;
  bulletSpeed: number;
  bulletCount: number;
  damage: number;
  /** 弾同士の左右オフセット(px)。[設計値] */
  spread: number;
  /** chip_targeting用。0〜1、命中時ではなく発射時にダメージへ反映する */
  critChance: number;
  critDamageMultiplier: number;
}

export class MainGun {
  // ローグライト(モジュール/チップ)で実行中に書き換わりうるため readonly にしない。
  // 02_CORE_SPEC.md §7 mod_spread(弾数+spread)/chip_barrel(ATK%)/chip_gyro(攻撃速度%)向け。
  private config: MainGunConfig;
  private cooldown = 0;

  constructor(config: MainGunConfig) {
    this.config = config;
  }

  /** BuildSystem側の装備が変わった時に呼ぶ。次のfireCooldownから新しい値が反映される */
  applyLoadout(config: MainGunConfig): void {
    this.config = config;
  }

  update(dt: number, craftState: CraftState, craftX: number, craftY: number, bulletSystem: BulletSystem): void {
    if (craftState === 'DRAIN') return; // 攻撃とドレインは排他(02_CORE_SPEC.md §2.1)

    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown += this.config.fireInterval;
    this.fire(craftX, craftY, bulletSystem);
  }

  private fire(craftX: number, craftY: number, bulletSystem: BulletSystem): void {
    const { bulletCount, spread, bulletSpeed, damage, critChance, critDamageMultiplier } = this.config;
    for (let i = 0; i < bulletCount; i += 1) {
      const offset = (i - (bulletCount - 1) / 2) * spread;
      const shotDamage = Math.random() < critChance ? damage * critDamageMultiplier : damage;
      bulletSystem.spawnPlayerBullet(craftX + offset, craftY - 24, 0, -bulletSpeed, shotDamage);
    }
  }
}
