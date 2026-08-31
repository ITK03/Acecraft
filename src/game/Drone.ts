import { Container, Graphics } from 'pixi.js';
import type { CraftState } from './Craft';
import type { BulletSystem } from './BulletSystem';
import type { EnemySystem } from './EnemySystem';

/**
 * mod_drone(サポートドローン)。02_CORE_SPEC.md §7.5「自律行動する小型機。独立に射撃」。
 * 自機に追従するが1:1で重ならないよう、自機からの相対オフセットへ毎フレーム緩やかに近づく
 * (「独立して行動している」印象を出すための遅延追従、[設計値])。追従自体はDRAIN中も止めないが、
 * 新規射撃はMainGunと同じく攻撃とドレインが排他(02_CORE_SPEC.md §2.1)。
 * 弾種は新しいBulletKindを増やさず、mod_homingflare用に既にある'flare'弾(spawnFlareBullet)を再利用する。
 * main.ts側で毎フレーム呼ばれるsteerFlareBullets()が全てのflare弾を最寄りの敵/ボスへ自動で曲げるため、
 * ドローン発の弾も自動的に追尾する(弾を撃った瞬間の初速方向はドローン→目標のおおよその向きで十分)。
 */
export interface DroneConfig {
  interval: number;
  damage: number;
  speed: number;
  searchRadius: number;
  /** chip_targeting用。0〜1、発射時にダメージへ反映する */
  critChance: number;
  critDamageMultiplier: number;
}

// 自機からの追従オフセット(右斜め上)。テスラタレット(左横)と重ならない側を選ぶ。[設計値]
const OFFSET_X = 55;
const OFFSET_Y = -40;
// 毎フレームの追従係数(固定タイムステップ1/60s前提の簡易lerp)。[設計値]
const FOLLOW_LERP = 0.12;
const BODY_RADIUS = 8;
// 敵撃破の輪や他モジュールの暖色/寒色と被らない色相としてローズピンクを採用する。[設計値]
const DRONE_COLOR = 0xff6fa8;

export class Drone {
  readonly view = new Container();
  private readonly body = new Graphics();
  private config: DroneConfig = { interval: 0, damage: 0, speed: 0, searchRadius: 0, critChance: 0, critDamageMultiplier: 1 };
  private cooldown = 0;
  private droneX = 0;
  private droneY = 0;
  private initialized = false;
  private readonly targetScratch = { x: 0, y: 0 };

  constructor() {
    this.body
      .moveTo(0, -BODY_RADIUS)
      .lineTo(BODY_RADIUS, 0)
      .lineTo(0, BODY_RADIUS)
      .lineTo(-BODY_RADIUS, 0)
      .closePath()
      .fill({ color: DRONE_COLOR, alpha: 0.9 })
      .stroke({ width: 2, color: 0x1a1020 });
    this.body.visible = false;
    this.view.addChild(this.body);
  }

  applyLoadout(config: DroneConfig): void {
    this.config = config;
  }

  update(dt: number, craftState: CraftState, craftX: number, craftY: number, bulletSystem: BulletSystem, enemySystem: EnemySystem): void {
    if (this.config.interval <= 0) {
      this.body.visible = false;
      this.initialized = false;
      return;
    }

    const targetX = craftX + OFFSET_X;
    const targetY = craftY + OFFSET_Y;
    if (!this.initialized) {
      // 初回所持時はいきなり追従先へ出現させる(遠くから飛んでくる違和感を避ける)。
      this.droneX = targetX;
      this.droneY = targetY;
      this.initialized = true;
    } else {
      this.droneX += (targetX - this.droneX) * FOLLOW_LERP;
      this.droneY += (targetY - this.droneY) * FOLLOW_LERP;
    }
    this.body.visible = true;
    this.body.x = this.droneX;
    this.body.y = this.droneY;

    if (craftState === 'DRAIN') return; // 攻撃とドレインは排他(02_CORE_SPEC.md §2.1)

    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown += this.config.interval;

    const targetIndex = enemySystem.findNearestActiveEnemyExcluding(this.droneX, this.droneY, this.config.searchRadius, -1, this.targetScratch);
    if (targetIndex === -1) return;
    const dx = this.targetScratch.x - this.droneX;
    const dy = this.targetScratch.y - this.droneY;
    const dist = Math.hypot(dx, dy) || 1;
    const vx = (dx / dist) * this.config.speed;
    const vy = (dy / dist) * this.config.speed;
    const damage = Math.random() < this.config.critChance ? this.config.damage * this.config.critDamageMultiplier : this.config.damage;
    bulletSystem.spawnFlareBullet(this.droneX, this.droneY, vx, vy, damage);
  }
}
