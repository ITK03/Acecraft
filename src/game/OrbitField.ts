import { Container, Graphics } from 'pixi.js';
import type { BulletSystem } from './BulletSystem';

/**
 * mod_orbit(オービットコア)。02_CORE_SPEC.md §7.5「自機周囲を旋回。敵弾をブロックする」。
 * BuildSystem.StatModifiers から毎回状態(所持数・半径・速度)を受け取るだけの受動的なクラス。
 * orbitCount===0(未所持)の間は何もしない。
 */

const MAX_ORBITERS = 3; // mod_orbitのLv3が上限
// resolveBlocking用: Pool.forEachActive走査中にconsumeCraftHit(release)すると密配列が壊れるため、
// 先にブロック対象を集めてから走査後にまとめて消費する(既存の二段階パターンと同じ)。
const HIT_SCRATCH_SIZE = 32;

export class OrbitField {
  readonly view = new Container();
  private readonly graphics: Graphics[] = [];

  private count = 0;
  private blockRadius = 0;
  private orbitRadius = 0;
  private orbitSpeedRad = 0;
  private angle = 0;

  private readonly hitKindScratch = new Uint8Array(HIT_SCRATCH_SIZE); // 0=enemyNormal, 1=enemyCharge
  private readonly hitIndexScratch = new Int32Array(HIT_SCRATCH_SIZE);

  constructor() {
    for (let i = 0; i < MAX_ORBITERS; i += 1) {
      const g = new Graphics();
      g.visible = false;
      this.graphics.push(g);
      this.view.addChild(g);
    }
  }

  /** BuildSystem.onModifiersChanged から呼ぶ。半径が変わったら見た目も引き直す */
  applyLoadout(count: number, blockRadius: number, orbitRadius: number, orbitSpeedRad: number): void {
    this.count = count;
    this.blockRadius = blockRadius;
    this.orbitRadius = orbitRadius;
    this.orbitSpeedRad = orbitSpeedRad;
    for (const g of this.graphics) {
      // マゼンタ/敵色と被らない白系(自機の充填色と同じ「自機由来の力」の表現)。
      g.clear().circle(0, 0, blockRadius * 0.5).fill({ color: 0xffffff, alpha: 0.85 }).stroke({ width: 2, color: 0x1a1020 });
    }
  }

  update(dt: number, craftX: number, craftY: number, bulletSystem: BulletSystem): void {
    if (this.count <= 0) {
      for (const g of this.graphics) g.visible = false;
      return;
    }

    this.angle += this.orbitSpeedRad * dt;
    for (let i = 0; i < MAX_ORBITERS; i += 1) {
      const g = this.graphics[i];
      if (i >= this.count) {
        g.visible = false;
        continue;
      }
      const a = this.angle + (i / this.count) * Math.PI * 2;
      g.visible = true;
      g.x = craftX + Math.cos(a) * this.orbitRadius;
      g.y = craftY + Math.sin(a) * this.orbitRadius;
    }

    this.resolveBlocking(bulletSystem);
  }

  private resolveBlocking(bulletSystem: BulletSystem): void {
    let hitCount = 0;
    bulletSystem.forEachActiveEnemyBullet((bullet, kind, index) => {
      if (hitCount >= HIT_SCRATCH_SIZE) return;
      for (let i = 0; i < this.count; i += 1) {
        const g = this.graphics[i];
        const dx = bullet.x - g.x;
        const dy = bullet.y - g.y;
        const rSum = this.blockRadius + bullet.radius;
        if (dx * dx + dy * dy <= rSum * rSum) {
          this.hitKindScratch[hitCount] = kind === 'enemyCharge' ? 1 : 0;
          this.hitIndexScratch[hitCount] = index;
          hitCount += 1;
          break;
        }
      }
    });
    for (let i = 0; i < hitCount; i += 1) {
      bulletSystem.consumeCraftHit(this.hitKindScratch[i] === 1 ? 'enemyCharge' : 'enemyNormal', this.hitIndexScratch[i]);
    }
  }
}
