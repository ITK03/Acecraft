import { Container, Graphics } from 'pixi.js';
import { Pool, type Poolable } from '../core/Pool';
import { SpatialGrid } from '../core/SpatialGrid';
import { LOGICAL_WIDTH, LOGICAL_HEIGHT } from '../core/Viewport';
import type { BulletSystem } from './BulletSystem';
import enemyDefs from '../data/enemies.json';
import balance from '../data/balance.json';

/**
 * 敵システム。02_CORE_SPEC.md §5「敵とウェーブ」の最小サブセット。
 * moveScript は straightDown、fireScript は aimed/spread の2パターンを実装する。
 * スポーンのタイミング・構成(いつ・何体)は WaveDirector が管理し、
 * このクラスは trySpawnGrunt() を叩かれたら1体出す、という受動的な役割に徹する。
 */

interface Enemy extends Poolable {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  fireCooldown: number;
}

interface EffectParticle extends Poolable {
  x: number;
  y: number;
  life: number;
}

const GRID_MARGIN = 100;
const GRID_CELL_SIZE = 64;
const EFFECT_CAPACITY = 16;
const EFFECT_DURATION = 0.25; // 秒 [設計値]

const def = enemyDefs.grunt;

function makeEnemy(): Enemy {
  return { active: false, x: 0, y: 0, hp: 0, maxHp: 0, fireCooldown: 0 };
}
function makeEffect(): EffectParticle {
  return { active: false, x: 0, y: 0, life: 0 };
}

export class EnemySystem {
  private readonly capacity: number;
  private readonly pool: Pool<Enemy>;
  private readonly graphics: Graphics[] = [];

  private readonly grid: SpatialGrid;
  private readonly gridScratchX: Float32Array;
  private readonly gridScratchY: Float32Array;
  private readonly gridScratchKey: Int32Array;

  private readonly effectPool = new Pool<EffectParticle>(EFFECT_CAPACITY, makeEffect);
  private readonly effectGraphics: Graphics[] = [];

  readonly view = new Container();
  private readonly enemyLayer = new Container();
  private readonly effectLayer = new Container();

  constructor() {
    this.capacity = balance.enemySystem.capacity;
    this.pool = new Pool<Enemy>(this.capacity, makeEnemy);

    this.grid = new SpatialGrid(
      -GRID_MARGIN,
      -GRID_MARGIN,
      LOGICAL_WIDTH + GRID_MARGIN * 2,
      LOGICAL_HEIGHT + GRID_MARGIN * 2,
      GRID_CELL_SIZE,
      this.capacity,
    );
    this.gridScratchX = new Float32Array(this.capacity);
    this.gridScratchY = new Float32Array(this.capacity);
    this.gridScratchKey = new Int32Array(this.capacity);

    for (let i = 0; i < this.capacity; i += 1) {
      const g = new Graphics()
        .circle(0, 0, def.hitRadius)
        .fill(0xd65f8a)
        .stroke({ width: 2, color: 0x1a1020 });
      g.visible = false;
      this.graphics.push(g);
      this.enemyLayer.addChild(g);
    }
    for (let i = 0; i < EFFECT_CAPACITY; i += 1) {
      const g = new Graphics().circle(0, 0, def.hitRadius).stroke({ width: 3, color: 0xffe9a8 });
      g.visible = false;
      this.effectGraphics.push(g);
      this.effectLayer.addChild(g);
    }

    this.view.addChild(this.enemyLayer, this.effectLayer);
  }

  update(dt: number, craftX: number, craftY: number, bulletSystem: BulletSystem): void {
    this.moveEnemies(dt);
    this.fireEnemies(dt, craftX, craftY, bulletSystem);
    this.rebuildGrid();
    this.resolvePlayerBulletHits(bulletSystem);
    this.updateEffects(dt);
  }

  /** WaveDirector から呼ばれる。1体出現させ、成功したかを返す(容量上限なら false) */
  trySpawnGrunt(): boolean {
    const acquired = this.pool.acquire();
    if (!acquired) return false; // 上限到達。T9で容量を実測調整する
    const { index, item } = acquired;
    item.x = 40 + Math.random() * (LOGICAL_WIDTH - 80);
    item.y = -GRID_MARGIN;
    item.hp = def.hp;
    item.maxHp = def.hp;
    item.fireCooldown = Math.random() * def.fireScript.cooldown; // 出現タイミングを散らす
    this.graphics[index].visible = true;
    return true;
  }

  private moveEnemies(dt: number): void {
    this.pool.forEachActive((enemy, index) => {
      enemy.y += def.fallSpeed * dt;
      if (def.wrapAround && enemy.y > LOGICAL_HEIGHT + GRID_MARGIN) {
        enemy.y = -GRID_MARGIN;
        enemy.x = 40 + Math.random() * (LOGICAL_WIDTH - 80);
      }
      const g = this.graphics[index];
      g.x = enemy.x;
      g.y = enemy.y;
    });
  }

  /** 02_CORE_SPEC.md §5.3 の aimed/spread パターンを実装する */
  private fireEnemies(dt: number, craftX: number, craftY: number, bulletSystem: BulletSystem): void {
    const fs = def.fireScript;
    this.pool.forEachActive((enemy) => {
      enemy.fireCooldown -= dt;
      if (enemy.fireCooldown > 0) return;
      enemy.fireCooldown += fs.cooldown;
      this.fireAt(enemy.x, enemy.y, craftX, craftY, bulletSystem);
    });
  }

  private fireAt(originX: number, originY: number, targetX: number, targetY: number, bulletSystem: BulletSystem): void {
    const fs = def.fireScript;
    const baseAngle = Math.atan2(targetY - originY, targetX - originX);
    const spreadRad = (fs.spreadAngleDeg * Math.PI) / 180;

    for (let i = 0; i < fs.count; i += 1) {
      let angle = baseAngle;
      if (fs.pattern === 'spread' && fs.count > 1) {
        const t = i / (fs.count - 1) - 0.5; // -0.5..0.5
        angle = baseAngle + t * spreadRad;
      }
      const vx = Math.cos(angle) * fs.speed;
      const vy = Math.sin(angle) * fs.speed;
      const chargeable = Math.random() < fs.chargeableRate;
      bulletSystem.spawnEnemyBullet(chargeable ? 'enemyCharge' : 'enemyNormal', originX, originY, vx, vy, def.contactDamage);
    }
  }

  /**
   * カウンター発動時の範囲ダメージ(02_CORE_SPEC.md §3.4)。命中した敵の数を返す。
   * onCounterFire は craft.update() の内部から同期的に発火するため、EnemySystem.update() の
   * 通常の毎フレームグリッド更新より先に呼ばれることがある。呼び出し直前の敵位置を確実に
   * 反映するため、ここで明示的にグリッドを再構築してから判定する。
   */
  applyCounterBurst(x: number, y: number, radius: number, damage: number): number {
    this.rebuildGrid();
    let hitCount = 0;
    this.grid.forEachNear(x, y, radius, (enemyIndex) => {
      const enemy = this.pool.get(enemyIndex);
      if (!enemy.active) return;
      const dx = enemy.x - x;
      const dy = enemy.y - y;
      if (dx * dx + dy * dy > radius * radius) return;
      enemy.hp -= damage;
      hitCount += 1;
      if (enemy.hp <= 0) this.killEnemy(enemyIndex);
    });
    return hitCount;
  }

  private rebuildGrid(): void {
    let count = 0;
    this.pool.forEachActive((enemy, index) => {
      this.gridScratchX[count] = enemy.x;
      this.gridScratchY[count] = enemy.y;
      this.gridScratchKey[count] = index;
      count += 1;
    });
    this.grid.rebuild(this.gridScratchX, this.gridScratchY, this.gridScratchKey, count);
  }

  private resolvePlayerBulletHits(bulletSystem: BulletSystem): void {
    const queryRadius = def.hitRadius + 24; // 24 = 自弾半径の上限を見込んだ余裕 [設計値]
    bulletSystem.forEachActivePlayerBullet((bullet, bulletIndex) => {
      let hitEnemyIndex = -1;
      this.grid.forEachNear(bullet.x, bullet.y, queryRadius, (enemyIndex) => {
        if (hitEnemyIndex !== -1) return; // 1発につき1体まで(貫通はpierceで別途対応)
        const enemy = this.pool.get(enemyIndex);
        const dx = bullet.x - enemy.x;
        const dy = bullet.y - enemy.y;
        const rSum = def.hitRadius + bullet.radius;
        if (dx * dx + dy * dy <= rSum * rSum) hitEnemyIndex = enemyIndex;
      });
      if (hitEnemyIndex === -1) return;

      const enemy = this.pool.get(hitEnemyIndex);
      enemy.hp -= bullet.damage;
      bulletSystem.consumeHit('player', bulletIndex);
      if (enemy.hp <= 0) this.killEnemy(hitEnemyIndex);
    });
  }

  private killEnemy(index: number): void {
    const enemy = this.pool.get(index);
    this.spawnEffect(enemy.x, enemy.y);
    this.graphics[index].visible = false;
    this.pool.release(index);
  }

  private spawnEffect(x: number, y: number): void {
    const acquired = this.effectPool.acquire();
    if (!acquired) return;
    const { index, item } = acquired;
    item.x = x;
    item.y = y;
    item.life = EFFECT_DURATION;
    const g = this.effectGraphics[index];
    g.visible = true;
    g.x = x;
    g.y = y;
    g.scale.set(0.4);
    g.alpha = 1;
  }

  private updateEffects(dt: number): void {
    this.effectPool.forEachActive((effect, index) => {
      effect.life -= dt;
      const g = this.effectGraphics[index];
      if (effect.life <= 0) {
        g.visible = false;
        this.effectPool.release(index);
        return;
      }
      const t = 1 - effect.life / EFFECT_DURATION;
      g.scale.set(0.4 + t * 1.6);
      g.alpha = 1 - t;
    });
  }

  get activeCount(): number {
    return this.pool.activeCount;
  }
}
