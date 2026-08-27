import { Container, Graphics } from 'pixi.js';
import type { CraftState } from './Craft';
import type { EnemySystem } from './EnemySystem';
import type { BulletSystem } from './BulletSystem';

/**
 * mod_laser(ピアッシングレーザー)。02_CORE_SPEC.md §7.5「前方に貫通レーザーを継続照射。
 * 敵弾をブロック」。MainGunと同じくMOVE/COUNTER中のみ有効(DRAIN中は撃たない、
 * 02_CORE_SPEC.md §2.1「攻撃とドレインは排他」)。自機の真上、画面上端までの帯状の範囲に
 * 常時ダメージを与え続け、触れた敵弾も破壊する。damagePerSecond<=0(未所持)の間は何もしない。
 */
export interface LaserBeamConfig {
  halfWidth: number;
  damagePerSecond: number;
}

const HIT_SCRATCH_SIZE = 32;
// 敵撃破の輪(暖色)/オービットの白/フレアの若草色と被らない色相として水色を採用する。[設計値]
const BEAM_COLOR = 0x6fe0ff;

export class LaserBeam {
  readonly view = new Container();
  private readonly beam = new Graphics();
  private config: LaserBeamConfig = { halfWidth: 0, damagePerSecond: 0 };

  private readonly bulletHitKindScratch = new Uint8Array(HIT_SCRATCH_SIZE);
  private readonly bulletHitIndexScratch = new Int32Array(HIT_SCRATCH_SIZE);

  constructor() {
    this.beam.visible = false;
    this.view.addChild(this.beam);
  }

  applyLoadout(config: LaserBeamConfig): void {
    this.config = config;
  }

  update(dt: number, craftState: CraftState, craftX: number, craftY: number, enemySystem: EnemySystem, bulletSystem: BulletSystem): void {
    if (this.config.damagePerSecond <= 0 || craftState === 'DRAIN') {
      this.beam.visible = false;
      return;
    }

    const minX = craftX - this.config.halfWidth;
    const maxX = craftX + this.config.halfWidth;
    const maxY = craftY;

    enemySystem.applyBeamDamage(minX, maxX, maxY, this.config.damagePerSecond * dt);
    this.blockBullets(minX, maxX, maxY, bulletSystem);

    this.beam.visible = true;
    this.beam.clear().rect(-this.config.halfWidth, -craftY, this.config.halfWidth * 2, craftY).fill({ color: BEAM_COLOR, alpha: 0.22 });
    this.beam.x = craftX;
    this.beam.y = craftY;
  }

  private blockBullets(minX: number, maxX: number, maxY: number, bulletSystem: BulletSystem): void {
    let hitCount = 0;
    bulletSystem.forEachActiveEnemyBullet((bullet, kind, index) => {
      if (hitCount >= HIT_SCRATCH_SIZE) return;
      if (bullet.x < minX || bullet.x > maxX || bullet.y > maxY) return;
      this.bulletHitKindScratch[hitCount] = kind === 'enemyCharge' ? 1 : 0;
      this.bulletHitIndexScratch[hitCount] = index;
      hitCount += 1;
    });
    for (let i = 0; i < hitCount; i += 1) {
      bulletSystem.consumeCraftHit(this.bulletHitKindScratch[i] === 1 ? 'enemyCharge' : 'enemyNormal', this.bulletHitIndexScratch[i]);
    }
  }
}
