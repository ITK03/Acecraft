import { Container, Graphics } from 'pixi.js';
import type { CraftState } from './Craft';
import type { EnemySystem } from './EnemySystem';
import type { BulletSystem } from './BulletSystem';

/**
 * mod_laser(ピアッシングレーザー)。02_CORE_SPEC.md §7.5「前方に貫通レーザーを継続照射。
 * 敵弾をブロック」。MainGunと同じくMOVE/COUNTER中のみ有効(DRAIN中は撃たない、
 * 02_CORE_SPEC.md §2.1「攻撃とドレインは排他」)。damagePerSecond<=0(未所持)の間は何もしない。
 *
 * ユーザーフィードバック「ビームが常時出てるし、触れると敵の攻撃全部消える。強すぎる」により、
 * 自機から画面最上端まで届く(=実質プレイフィールド全高)帯を常時ブロックし続けると、
 * その帯の上を通る弾が事実上すべて消滅してしまい弾幕STGとして壊れるため、射程を有限にした。
 * 射程はレベルで伸びる値ではなく実装内部の固定値([設計値])として持つ。
 */
export interface LaserBeamConfig {
  halfWidth: number;
  damagePerSecond: number;
}

const HIT_SCRATCH_SIZE = 32;
// ビームの有効射程(自機からの距離)。[設計値]
const REACH = 520;
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
    const minY = Math.max(0, craftY - REACH);
    const beamLength = maxY - minY;

    enemySystem.applyBeamDamage(minX, maxX, minY, maxY, this.config.damagePerSecond * dt);
    this.blockBullets(minX, maxX, minY, maxY, bulletSystem);

    this.beam.visible = true;
    this.beam.clear().rect(-this.config.halfWidth, -beamLength, this.config.halfWidth * 2, beamLength).fill({ color: BEAM_COLOR, alpha: 0.22 });
    this.beam.x = craftX;
    this.beam.y = craftY;
  }

  private blockBullets(minX: number, maxX: number, minY: number, maxY: number, bulletSystem: BulletSystem): void {
    let hitCount = 0;
    bulletSystem.forEachActiveEnemyBullet((bullet, kind, index) => {
      if (hitCount >= HIT_SCRATCH_SIZE) return;
      if (bullet.x < minX || bullet.x > maxX || bullet.y > maxY || bullet.y < minY) return;
      this.bulletHitKindScratch[hitCount] = kind === 'enemyCharge' ? 1 : 0;
      this.bulletHitIndexScratch[hitCount] = index;
      hitCount += 1;
    });
    for (let i = 0; i < hitCount; i += 1) {
      bulletSystem.consumeCraftHit(this.bulletHitKindScratch[i] === 1 ? 'enemyCharge' : 'enemyNormal', this.bulletHitIndexScratch[i]);
    }
  }
}
