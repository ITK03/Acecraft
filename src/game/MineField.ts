import { Container, Graphics } from 'pixi.js';
import { Pool, type Poolable } from '../core/Pool';
import type { CraftState } from './Craft';
import type { EnemySystem } from './EnemySystem';

/**
 * mod_mine(ドリフトマイン)。02_CORE_SPEC.md §7.5「設置型機雷。接触で爆発」。
 * MainGunと同じくMOVE/COUNTER中のみ新規設置する(DRAIN中は設置しない)が、既に置かれている機雷の
 * 寿命・起爆判定はDRAIN中も継続する(設置物なので自機の攻撃可否とは独立)。
 * interval<=0(未所持)の間は一度も設置されないため、機雷も存在しない(モジュールは一度所持したら
 * 手放せない仕様のため「所持→未所持に戻る」ケースは無く、設置済み機雷の後片付けは不要)。
 */
export interface MineFieldConfig {
  interval: number;
  radius: number;
  damage: number;
  duration: number;
  /** chip_targeting用。0〜1、起爆時にダメージへ反映する */
  critChance: number;
  critDamageMultiplier: number;
}

interface Mine extends Poolable {
  x: number;
  y: number;
  life: number;
}

function makeMine(): Mine {
  return { active: false, x: 0, y: 0, life: 0 };
}

// 同時設置数の上限。所持しているだけで画面を埋め尽くさないよう小さめに固定する([設計値]、レベルでは変えない)。
const MINE_CAPACITY = 6;
// 接触判定半径(機雷の見た目サイズに合わせる)。[設計値]
const TRIGGER_RADIUS = 22;
const EXPLODE_EFFECT_DURATION = 0.3;
// 敵撃破の輪(暖色)/エリアストライクの黄色と被らない色相として警告色の橙を採用する。[設計値]
const MINE_COLOR = 0xff8c42;

export class MineField {
  readonly view = new Container();
  private readonly pool = new Pool<Mine>(MINE_CAPACITY, makeMine);
  private readonly graphics: Graphics[] = [];
  private config: MineFieldConfig = { interval: 0, radius: 0, damage: 0, duration: 0, critChance: 0, critDamageMultiplier: 1 };
  private placeCooldown = 0;

  // update()内でPool.forEachActive走査中にreleaseすると密配列が壊れるため、
  // 「寿命切れ(無言で消える)」「接触起爆(ダメージを与えて消える)」を別々に集めてから走査後にまとめて処理する。
  private readonly expireScratch = new Int32Array(MINE_CAPACITY);
  private readonly explodeScratch = new Int32Array(MINE_CAPACITY);
  private readonly targetScratch = { x: 0, y: 0 };

  private readonly explodeEffect = new Graphics();
  private explodeLife = 0;
  private explodeRadius = 0;

  constructor() {
    for (let i = 0; i < MINE_CAPACITY; i += 1) {
      const g = new Graphics();
      g.circle(0, 0, TRIGGER_RADIUS * 0.55).fill({ color: MINE_COLOR, alpha: 0.85 }).stroke({ width: 2, color: 0x1a1020 });
      g.visible = false;
      this.graphics.push(g);
      this.view.addChild(g);
    }
    this.explodeEffect.visible = false;
    this.view.addChild(this.explodeEffect);
  }

  applyLoadout(config: MineFieldConfig): void {
    this.config = config;
  }

  update(dt: number, craftState: CraftState, craftX: number, craftY: number, enemySystem: EnemySystem): void {
    this.updateMines(dt, enemySystem);
    this.updateExplodeEffect(dt);
    if (this.config.interval <= 0) return; // 未所持
    if (craftState === 'DRAIN') return; // 新規設置は主砲等と同じく攻撃とドレインが排他(02_CORE_SPEC.md §2.1)

    this.placeCooldown -= dt;
    if (this.placeCooldown > 0) return;
    this.placeCooldown += this.config.interval;
    this.placeMine(craftX, craftY);
  }

  private updateMines(dt: number, enemySystem: EnemySystem): void {
    let expireCount = 0;
    let explodeCount = 0;
    this.pool.forEachActive((mine, index) => {
      mine.life -= dt;
      this.graphics[index].x = mine.x;
      this.graphics[index].y = mine.y;
      if (mine.life <= 0) {
        if (expireCount < this.expireScratch.length) {
          this.expireScratch[expireCount] = index;
          expireCount += 1;
        }
        return;
      }
      const hitIndex = enemySystem.findNearestActiveEnemyExcluding(mine.x, mine.y, TRIGGER_RADIUS, -1, this.targetScratch);
      if (hitIndex !== -1 && explodeCount < this.explodeScratch.length) {
        this.explodeScratch[explodeCount] = index;
        explodeCount += 1;
      }
    });

    for (let i = 0; i < expireCount; i += 1) this.removeMine(this.expireScratch[i]);
    for (let i = 0; i < explodeCount; i += 1) {
      const index = this.explodeScratch[i];
      const mine = this.pool.get(index);
      const damage = Math.random() < this.config.critChance ? this.config.damage * this.config.critDamageMultiplier : this.config.damage;
      enemySystem.applyRadiusDamage(mine.x, mine.y, this.config.radius, damage);
      this.spawnExplodeEffect(mine.x, mine.y);
      this.removeMine(index);
    }
  }

  private placeMine(x: number, y: number): void {
    let acquired = this.pool.acquire();
    if (!acquired) {
      // 満杯なら最も古い機雷を消して新しい機雷を置く(常に直近N個を保つ、ドリフトマインらしい挙動)。
      const oldest = this.pool.oldestActiveIndex();
      if (oldest === null) return;
      this.removeMine(oldest);
      acquired = this.pool.acquire();
      if (!acquired) return;
    }
    const { index, item } = acquired;
    item.x = x;
    item.y = y;
    item.life = this.config.duration;
    const g = this.graphics[index];
    g.visible = true;
    g.x = x;
    g.y = y;
    g.alpha = 1;
  }

  private removeMine(index: number): void {
    this.graphics[index].visible = false;
    this.pool.release(index);
  }

  private spawnExplodeEffect(x: number, y: number): void {
    this.explodeLife = EXPLODE_EFFECT_DURATION;
    this.explodeRadius = this.config.radius;
    this.explodeEffect.visible = true;
    this.explodeEffect.x = x;
    this.explodeEffect.y = y;
    this.explodeEffect.alpha = 1;
  }

  private updateExplodeEffect(dt: number): void {
    if (this.explodeLife <= 0) return;
    this.explodeLife -= dt;
    if (this.explodeLife <= 0) {
      this.explodeEffect.visible = false;
      return;
    }
    const t = 1 - this.explodeLife / EXPLODE_EFFECT_DURATION;
    this.explodeEffect.clear().circle(0, 0, this.explodeRadius * (0.3 + t * 0.7)).stroke({ width: 4, color: MINE_COLOR, alpha: 1 - t });
  }
}
