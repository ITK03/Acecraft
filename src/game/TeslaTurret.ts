import { Container, Graphics } from 'pixi.js';
import type { CraftState } from './Craft';
import type { EnemySystem } from './EnemySystem';

/**
 * mod_tesla(テスラタレット)。02_CORE_SPEC.md §7.5「自動生成される固定砲台。周期的に雷撃」。
 * 「固定」の解釈: マップ上の1点に据え置く仕様書ではなく(常に移動し続ける弾幕STGでは実用的でない)、
 * 自機からの相対オフセットに常駐する自動追従型の砲台として実装する([設計値])。狙いは自動(入力不要)、
 * MOVE/COUNTER中のみ稼働(DRAIN中は主砲等と同じく停止)。interval<=0(未所持)の間は描画も判定もしない。
 */
export interface TeslaTurretConfig {
  interval: number;
  damage: number;
  searchRadius: number;
  /** chip_targeting用。0〜1、発動時にダメージへ反映する */
  critChance: number;
  critDamageMultiplier: number;
}

// 自機からの据え置きオフセット(左横)。[設計値]
const OFFSET_X = -50;
const OFFSET_Y = 0;
const TURRET_RADIUS = 10;
const BOLT_DURATION = 0.12;
// 敵撃破の輪(暖色)/フレアの若草色と被らない色相として電撃らしい薄紫を採用する。[設計値]
const TESLA_COLOR = 0xd6b3ff;

export class TeslaTurret {
  readonly view = new Container();
  private readonly body = new Graphics();
  private readonly bolt = new Graphics();
  private config: TeslaTurretConfig = { interval: 0, damage: 0, searchRadius: 0, critChance: 0, critDamageMultiplier: 1 };
  private cooldown = 0;
  private boltLife = 0;
  private readonly targetScratch = { x: 0, y: 0 };
  private turretX = 0;
  private turretY = 0;

  constructor() {
    this.body.circle(0, 0, TURRET_RADIUS).fill({ color: TESLA_COLOR, alpha: 0.9 }).stroke({ width: 2, color: 0x1a1020 });
    this.body.visible = false;
    this.bolt.visible = false;
    this.view.addChild(this.body, this.bolt);
  }

  applyLoadout(config: TeslaTurretConfig): void {
    this.config = config;
  }

  update(dt: number, craftState: CraftState, craftX: number, craftY: number, enemySystem: EnemySystem): void {
    this.updateBolt(dt);
    if (this.config.interval <= 0) {
      this.body.visible = false;
      return;
    }
    this.turretX = craftX + OFFSET_X;
    this.turretY = craftY + OFFSET_Y;
    this.body.visible = true;
    this.body.x = this.turretX;
    this.body.y = this.turretY;

    if (craftState === 'DRAIN') return; // 攻撃とドレインは排他(02_CORE_SPEC.md §2.1)

    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown += this.config.interval;

    // findNearestActiveEnemyExcluding はmod_bouncer用に追加したメソッドだが、
    // excludeIndex=-1(実在しないpool index)を渡せば「除外なしの最近傍探索」として素直に使い回せる。
    const targetIndex = enemySystem.findNearestActiveEnemyExcluding(this.turretX, this.turretY, this.config.searchRadius, -1, this.targetScratch);
    if (targetIndex === -1) return;
    const damage = Math.random() < this.config.critChance ? this.config.damage * this.config.critDamageMultiplier : this.config.damage;
    enemySystem.applyDirectDamage(targetIndex, damage);

    this.boltLife = BOLT_DURATION;
    this.bolt.visible = true;
    this.bolt.alpha = 1;
    this.bolt.clear().moveTo(0, 0).lineTo(this.targetScratch.x - this.turretX, this.targetScratch.y - this.turretY).stroke({ width: 3, color: TESLA_COLOR });
    this.bolt.x = this.turretX;
    this.bolt.y = this.turretY;
  }

  private updateBolt(dt: number): void {
    if (this.boltLife <= 0) return;
    this.boltLife -= dt;
    if (this.boltLife <= 0) this.bolt.visible = false;
    else this.bolt.alpha = this.boltLife / BOLT_DURATION;
  }
}
