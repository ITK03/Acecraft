import type { Craft } from './Craft';
import type { BulletSystem } from './BulletSystem';

/**
 * ドレイン(吸収)フィールド。02_CORE_SPEC.md §3.1「吸引判定」§3.2「チャージ蓄積」。
 *
 * - craft.state === 'DRAIN' のときだけ動作する(攻撃とドレインは排他)
 * - 扇形(半径 radius、上方向 ±angleDeg)内にある「チャージ弾のみ」を毎フレーム再判定し、
 *   範囲内ならクラフト方向へ加速しながら軌道を曲げる(蓄積した吸引力が可視化されるように)
 * - craft.hitRadius + absorbMargin まで到達したら消滅させ、craft.charge を+1(上限 chargeMax)
 * - 通常弾(chargeable=false)には一切干渉しない(素通りしてクラフトに直接当たりうる)
 * - DRAIN に入ってからの経過時間で吸引力を rampUpSeconds かけて 0→全開にする
 */

export interface DrainFieldConfig {
  radius: number;
  angleDeg: number;
  pullSpeed: number;
  pullAccel: number;
  absorbMargin: number;
  rampUpSeconds: number;
  chargeMax: number;
}

export class DrainField {
  private readonly config: DrainFieldConfig;
  private activeTime = 0;
  private wasActive = false;

  // update()内でPool.forEachActiveを回している最中に release すると密配列(スワップ削除)が
  // 壊れるため、吸収対象の添字を先に集めてから走査後にまとめて absorb する。
  private readonly absorbScratch: Int32Array;

  /** T5: 弾を1発吸収するたびに呼ばれる。吸引音の再生などに使う */
  onAbsorb?: (newCharge: number) => void;

  constructor(config: DrainFieldConfig, enemyChargeCapacity: number) {
    this.config = config;
    this.absorbScratch = new Int32Array(enemyChargeCapacity);
  }

  /** 固定ステップで呼ぶ。bulletSystem.update() より前に呼ぶこと(このフレームの移動に反映させるため) */
  update(dt: number, craft: Craft, bulletSystem: BulletSystem): void {
    const isActive = craft.state === 'DRAIN';
    if (isActive && !this.wasActive) this.activeTime = 0;
    this.wasActive = isActive;
    if (!isActive) return;

    this.activeTime += dt;
    const ramp = Math.min(1, this.activeTime / this.config.rampUpSeconds);
    const angleRad = (this.config.angleDeg * Math.PI) / 180;
    const absorbDistance = craft.hitRadius + this.config.absorbMargin;

    let absorbCount = 0;
    bulletSystem.forEachActiveEnemyChargeBullet((bullet, index) => {
      const dx = bullet.x - craft.x;
      const dy = bullet.y - craft.y;
      const distSq = dx * dx + dy * dy;

      if (distSq <= absorbDistance * absorbDistance) {
        if (absorbCount < this.absorbScratch.length) {
          this.absorbScratch[absorbCount] = index;
          absorbCount += 1;
        }
        return;
      }

      if (distSq > this.config.radius * this.config.radius) return;

      const dist = Math.sqrt(distSq);
      // "up" = (0, -1) からの角度。dot((dx,dy)/dist, (0,-1)) = -dy/dist
      const angleFromUp = Math.acos(Math.max(-1, Math.min(1, -dy / dist)));
      if (angleFromUp > angleRad) return;

      // 加速しながら吸い込む: 現在速度を目標速度(クラフト方向)へ向けて徐々に伸ばす
      const dirX = -dx / dist;
      const dirY = -dy / dist;
      const currentSpeed = Math.sqrt(bullet.vx * bullet.vx + bullet.vy * bullet.vy);
      const targetSpeed = this.config.pullSpeed * ramp;
      const nextSpeed = Math.min(targetSpeed, currentSpeed + this.config.pullAccel * ramp * dt);
      bullet.vx = dirX * nextSpeed;
      bullet.vy = dirY * nextSpeed;
    });

    for (let i = 0; i < absorbCount; i += 1) {
      bulletSystem.absorbEnemyChargeBullet(this.absorbScratch[i]);
      craft.charge = Math.min(this.config.chargeMax, craft.charge + 1);
      this.onAbsorb?.(craft.charge);
    }
  }
}
