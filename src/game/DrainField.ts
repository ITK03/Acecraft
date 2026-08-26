import { Container, Graphics } from 'pixi.js';
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
 *
 * ユーザーフィードバック「吸収できる範囲が分かりづらい」「吸収中のエフェクトが欲しい」を受け、
 * 扇形の範囲そのものを半透明で描画し(ramp に応じてフェードイン)、吸収した瞬間にその弾の位置で
 * 小さな閃光エフェクトを出すようにした。
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

const ABSORB_EFFECT_CAPACITY = 16;
const ABSORB_EFFECT_DURATION = 0.22;
// DRAIN状態の機体色(0x8F7FBF)と揃え、「今どの領域が吸引中か」を機体の色から連想できるようにする。
const FIELD_COLOR = 0x8f7fbf;

interface AbsorbEffect {
  active: boolean;
  life: number;
  x: number;
  y: number;
}

export class DrainField {
  private readonly config: DrainFieldConfig;
  private activeTime = 0;
  private wasActive = false;

  // update()内でPool.forEachActiveを回している最中に release すると密配列(スワップ削除)が
  // 壊れるため、吸収対象の添字(と、エフェクト表示用に消滅位置)を先に集めてから走査後にまとめて absorb する。
  private readonly absorbScratch: Int32Array;
  private readonly absorbScratchX: Float32Array;
  private readonly absorbScratchY: Float32Array;

  readonly view = new Container();
  private readonly coneGraphics = new Graphics();
  private readonly absorbGraphics: Graphics[] = [];
  private readonly absorbEffects: AbsorbEffect[] = [];
  private nextAbsorbEffectSlot = 0;

  /** T5: 弾を1発吸収するたびに呼ばれる。吸引音の再生などに使う */
  onAbsorb?: (newCharge: number) => void;

  constructor(config: DrainFieldConfig, enemyChargeCapacity: number) {
    this.config = config;
    this.absorbScratch = new Int32Array(enemyChargeCapacity);
    this.absorbScratchX = new Float32Array(enemyChargeCapacity);
    this.absorbScratchY = new Float32Array(enemyChargeCapacity);

    this.view.addChild(this.coneGraphics);
    for (let i = 0; i < ABSORB_EFFECT_CAPACITY; i += 1) {
      const g = new Graphics();
      g.visible = false;
      this.absorbGraphics.push(g);
      this.view.addChild(g);
      this.absorbEffects.push({ active: false, life: 0, x: 0, y: 0 });
    }
  }

  /** 固定ステップで呼ぶ。bulletSystem.update() より前に呼ぶこと(このフレームの移動に反映させるため) */
  update(dt: number, craft: Craft, bulletSystem: BulletSystem): void {
    const isActive = craft.state === 'DRAIN';
    if (isActive && !this.wasActive) this.activeTime = 0;
    this.wasActive = isActive;
    this.updateAbsorbEffects(dt);

    if (!isActive) {
      this.redrawCone(craft, 0);
      return;
    }

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
          this.absorbScratchX[absorbCount] = bullet.x;
          this.absorbScratchY[absorbCount] = bullet.y;
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
      this.spawnAbsorbEffect(this.absorbScratchX[i], this.absorbScratchY[i]);
      this.onAbsorb?.(craft.charge);
    }

    this.redrawCone(craft, ramp);
  }

  private spawnAbsorbEffect(x: number, y: number): void {
    // 超短命なエフェクトのため専用Poolは過剰。固定サイズのリングバッファで使い回す。
    const slot = this.nextAbsorbEffectSlot;
    this.nextAbsorbEffectSlot = (this.nextAbsorbEffectSlot + 1) % ABSORB_EFFECT_CAPACITY;
    const effect = this.absorbEffects[slot];
    effect.active = true;
    effect.life = ABSORB_EFFECT_DURATION;
    effect.x = x;
    effect.y = y;
    this.absorbGraphics[slot].visible = true;
  }

  private updateAbsorbEffects(dt: number): void {
    for (let i = 0; i < ABSORB_EFFECT_CAPACITY; i += 1) {
      const effect = this.absorbEffects[i];
      if (!effect.active) continue;
      effect.life -= dt;
      const g = this.absorbGraphics[i];
      if (effect.life <= 0) {
        effect.active = false;
        g.visible = false;
        continue;
      }
      const t = 1 - effect.life / ABSORB_EFFECT_DURATION;
      g.clear()
        .circle(0, 0, 4 + t * 16)
        .stroke({ width: 3, color: 0xffffff, alpha: (1 - t) * 0.9 });
      g.x = effect.x;
      g.y = effect.y;
    }
  }

  private redrawCone(craft: Craft, ramp: number): void {
    this.coneGraphics.clear();
    if (ramp <= 0) return;

    const angleRad = (this.config.angleDeg * Math.PI) / 180;
    const startAngle = -Math.PI / 2 - angleRad;
    const endAngle = -Math.PI / 2 + angleRad;
    const steps = 20;
    const points: number[] = [0, 0];
    for (let i = 0; i <= steps; i += 1) {
      const a = startAngle + ((endAngle - startAngle) * i) / steps;
      points.push(Math.cos(a) * this.config.radius, Math.sin(a) * this.config.radius);
    }
    this.coneGraphics
      .poly(points)
      .fill({ color: FIELD_COLOR, alpha: 0.08 * ramp })
      .stroke({ width: 2, color: FIELD_COLOR, alpha: 0.35 * ramp });
    this.coneGraphics.x = craft.x;
    this.coneGraphics.y = craft.y;
  }
}
