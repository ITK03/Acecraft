import { Container, Graphics } from 'pixi.js';
import { Pool, type Poolable } from '../core/Pool';
import { SpatialGrid } from '../core/SpatialGrid';
import { LOGICAL_WIDTH, LOGICAL_HEIGHT } from '../core/Viewport';
import type { BulletSystem } from './BulletSystem';
import enemyDefs from '../data/enemies.json';
import balance from '../data/balance.json';

/**
 * 敵システム(T3時点)。02_CORE_SPEC.md §5「敵とウェーブ」の最小サブセット。
 * moveScript は straightDown、fireScript は空(未射撃)のみを実装する。
 * ウェーブ管理(スポーンのタイミング・構成)は T6 の WaveDirector が引き継ぐまでの
 * 暫定実装として、一定間隔で単一の敵種を降らせるだけの単純なスポーナーを内蔵する。
 */

interface Enemy extends Poolable {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
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
  return { active: false, x: 0, y: 0, hp: 0, maxHp: 0 };
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

  private spawnTimer = 0;

  constructor() {
    this.capacity = balance.devEnemySpawner.capacity;
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

  update(dt: number, bulletSystem: BulletSystem): void {
    this.updateSpawner(dt);
    this.moveEnemies(dt);
    this.rebuildGrid();
    this.resolvePlayerBulletHits(bulletSystem);
    this.updateEffects(dt);
  }

  private updateSpawner(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer += balance.devEnemySpawner.interval;

    const acquired = this.pool.acquire();
    if (!acquired) return; // 上限到達。T9で容量を実測調整する
    const { index, item } = acquired;
    item.x = 40 + Math.random() * (LOGICAL_WIDTH - 80);
    item.y = -GRID_MARGIN;
    item.hp = def.hp;
    item.maxHp = def.hp;
    this.graphics[index].visible = true;
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
