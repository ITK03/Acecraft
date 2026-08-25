import { Container, Particle, ParticleContainer, Text, TextStyle, type Renderer } from 'pixi.js';
import { Pool, type Poolable } from '../core/Pool';
import { SpatialGrid } from '../core/SpatialGrid';
import { LOGICAL_WIDTH, LOGICAL_HEIGHT } from '../core/Viewport';
import { bakeBulletTexture, ENEMY_NORMAL_BULLET, ENEMY_CHARGE_BULLET, PLAYER_BULLET } from '../game/BulletTextures';

/**
 * T1 弾幕ストレステスト(技術選定ゲート)。
 * 05_PHASE0_TASKS.md T1: 「敵弾600 + 自弾400 = 計1000スプライトを同時に動かし、
 * 全弾に衝突判定を通すシーンを作る」→「5分間連続で動かし、fpsの推移を記録する」。
 *
 * このモジュールはゲーム本編ではなく技術検証専用。02_CORE_SPEC.md の実ゲームプレイ
 * (Craft/BulletSystem/EnemySystem 等)は T2 以降で別途構築する。ここでの目的はただ一つ、
 * 「Web(PixiJS)でこの物量が iPhone 実機で 60fps を維持できるか」を実測で確定させること。
 *
 * 設計:
 * - 敵弾は「通常(420) + チャージ(180) = 600」「自弾400」の3プールに分割。
 *   chargeableRate=0.3 相当(180/600)で 02_CORE_SPEC.md §4.2 の既定値に合わせている。
 * - 全スロットを起動時に acquire したまま解放しない(トーラス状にラップ移動させる)ことで、
 *   スポーン/回収のノイズを排除し、「描画+衝突判定」のコストだけを測定できるようにする。
 *   実際のスポーン/回収は T3 以降の BulletSystem で本番相当の挙動として実装する。
 * - 衝突判定は自弾400発それぞれについて、敵弾600発が入ったグリッドへ近傍クエリを行う。
 *   これは実際のゲームプレイ(弾は自機1点しか見ない)より負荷が高い、意図的に厳しい構成。
 */

interface StressBullet extends Poolable {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const ENEMY_NORMAL_CAPACITY = 420;
const ENEMY_CHARGE_CAPACITY = 180;
const PLAYER_CAPACITY = 400;
const ENEMY_TOTAL_CAPACITY = ENEMY_NORMAL_CAPACITY + ENEMY_CHARGE_CAPACITY; // 600
const GRID_CELL_SIZE = 64;
const GRID_MARGIN = 32; // 半径分の余白を持たせてグリッド境界での取りこぼしを防ぐ

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function makeBullet(): StressBullet {
  return { active: false, x: 0, y: 0, vx: 0, vy: 0 };
}

export class StressTest {
  private readonly enemyNormalPool = new Pool<StressBullet>(ENEMY_NORMAL_CAPACITY, makeBullet);
  private readonly enemyChargePool = new Pool<StressBullet>(ENEMY_CHARGE_CAPACITY, makeBullet);
  private readonly playerPool = new Pool<StressBullet>(PLAYER_CAPACITY, makeBullet);

  private readonly enemyNormalParticles: Particle[] = [];
  private readonly enemyChargeParticles: Particle[] = [];
  private readonly playerParticles: Particle[] = [];

  private readonly enemyGrid = new SpatialGrid(
    -GRID_MARGIN,
    -GRID_MARGIN,
    LOGICAL_WIDTH + GRID_MARGIN * 2,
    LOGICAL_HEIGHT + GRID_MARGIN * 2,
    GRID_CELL_SIZE,
    ENEMY_TOTAL_CAPACITY,
  );

  // グリッド再構築用のスクラッチ(毎フレーム使い回す。ここで new しない)
  private readonly gridScratchX = new Float32Array(ENEMY_TOTAL_CAPACITY);
  private readonly gridScratchY = new Float32Array(ENEMY_TOTAL_CAPACITY);
  private readonly gridScratchKey = new Int32Array(ENEMY_TOTAL_CAPACITY);

  /** ゲーム世界(論理720x1280、ビューポート倍率でスケールされる)側に入れる描画 */
  readonly view = new Container();
  /** 画面座標系(スケールされない)に入れる HUD 側の描画。呼び出し側は app.stage に addChild すること */
  readonly hudView = new Container();
  private readonly statsText: Text;

  private elapsedSeconds = 0;
  private minFps = Infinity;
  private fpsSampleAccumTime = 0;
  private fpsSampleAccumFrames = 0;
  private lastCollisionCount = 0;

  constructor(renderer: Renderer) {
    const enemyNormalTexture = bakeBulletTexture(renderer, ENEMY_NORMAL_BULLET);
    const enemyChargeTexture = bakeBulletTexture(renderer, ENEMY_CHARGE_BULLET);
    const playerTexture = bakeBulletTexture(renderer, PLAYER_BULLET);

    const enemyNormalContainer = new ParticleContainer({ texture: enemyNormalTexture });
    const enemyChargeContainer = new ParticleContainer({ texture: enemyChargeTexture });
    const playerContainer = new ParticleContainer({ texture: playerTexture });

    for (let i = 0; i < ENEMY_NORMAL_CAPACITY; i += 1) {
      this.spawn(this.enemyNormalPool, this.enemyNormalParticles, enemyNormalContainer, enemyNormalTexture, 140, 260);
    }
    for (let i = 0; i < ENEMY_CHARGE_CAPACITY; i += 1) {
      this.spawn(this.enemyChargePool, this.enemyChargeParticles, enemyChargeContainer, enemyChargeTexture, 140, 260);
    }
    for (let i = 0; i < PLAYER_CAPACITY; i += 1) {
      this.spawn(this.playerPool, this.playerParticles, playerContainer, playerTexture, 700, 1100);
    }

    this.view.addChild(enemyNormalContainer, enemyChargeContainer, playerContainer);

    this.statsText = new Text({
      text: '',
      style: new TextStyle({ fill: '#ffe9a8', fontFamily: 'monospace', fontSize: 13, lineHeight: 17 }),
    });
    this.statsText.x = 8;
    this.statsText.y = 114; // DebugOverlay が5行(8 + 5*18)になった分の余白
    this.hudView.addChild(this.statsText);
  }

  private spawn(
    pool: Pool<StressBullet>,
    particles: Particle[],
    container: ParticleContainer,
    texture: import('pixi.js').Texture,
    speedMin: number,
    speedMax: number,
  ): void {
    const acquired = pool.acquire();
    if (!acquired) return; // 起動時充填なので通常は起こらない
    const { item } = acquired;
    item.x = randomRange(0, LOGICAL_WIDTH);
    item.y = randomRange(0, LOGICAL_HEIGHT);
    const angle = randomRange(0, Math.PI * 2);
    const speed = randomRange(speedMin, speedMax);
    item.vx = Math.cos(angle) * speed;
    item.vy = Math.sin(angle) * speed;

    const particle = new Particle(texture);
    particle.x = item.x;
    particle.y = item.y;
    particle.anchorX = 0.5;
    particle.anchorY = 0.5;
    particles.push(particle);
    container.addParticle(particle);
  }

  /** 固定ステップ(1/60秒)で呼ぶ。移動・ラップ・衝突判定・Particle座標同期をすべて行う */
  update(dt: number): void {
    this.elapsedSeconds += dt;

    this.moveAndWrap(this.enemyNormalPool, this.enemyNormalParticles);
    this.moveAndWrap(this.enemyChargePool, this.enemyChargeParticles);
    this.moveAndWrap(this.playerPool, this.playerParticles);

    this.rebuildEnemyGrid();
    this.lastCollisionCount = this.countPlayerVsEnemyOverlaps();
  }

  private moveAndWrap(pool: Pool<StressBullet>, particles: Particle[]): void {
    pool.forEachActive((bullet, index) => {
      bullet.x += bullet.vx * (1 / 60);
      bullet.y += bullet.vy * (1 / 60);

      if (bullet.x < 0) bullet.x += LOGICAL_WIDTH;
      else if (bullet.x >= LOGICAL_WIDTH) bullet.x -= LOGICAL_WIDTH;
      if (bullet.y < 0) bullet.y += LOGICAL_HEIGHT;
      else if (bullet.y >= LOGICAL_HEIGHT) bullet.y -= LOGICAL_HEIGHT;

      const particle = particles[index];
      particle.x = bullet.x;
      particle.y = bullet.y;
    });
  }

  private rebuildEnemyGrid(): void {
    let count = 0;
    this.enemyNormalPool.forEachActive((bullet, index) => {
      this.gridScratchX[count] = bullet.x;
      this.gridScratchY[count] = bullet.y;
      this.gridScratchKey[count] = index; // 0..419 = normal
      count += 1;
    });
    this.enemyChargePool.forEachActive((bullet, index) => {
      this.gridScratchX[count] = bullet.x;
      this.gridScratchY[count] = bullet.y;
      this.gridScratchKey[count] = ENEMY_NORMAL_CAPACITY + index; // 420.. = charge
      count += 1;
    });
    this.enemyGrid.rebuild(this.gridScratchX, this.gridScratchY, this.gridScratchKey, count);
  }

  private countPlayerVsEnemyOverlaps(): number {
    const queryRadius = ENEMY_CHARGE_BULLET.radius + PLAYER_BULLET.radius;
    let hits = 0;
    this.playerPool.forEachActive((playerBullet) => {
      this.enemyGrid.forEachNear(playerBullet.x, playerBullet.y, queryRadius, (key) => {
        const isCharge = key >= ENEMY_NORMAL_CAPACITY;
        const enemyBullet = isCharge
          ? this.enemyChargePool.get(key - ENEMY_NORMAL_CAPACITY)
          : this.enemyNormalPool.get(key);
        const enemyRadius = isCharge ? ENEMY_CHARGE_BULLET.radius : ENEMY_NORMAL_BULLET.radius;
        const dx = playerBullet.x - enemyBullet.x;
        const dy = playerBullet.y - enemyBullet.y;
        const rSum = enemyRadius + PLAYER_BULLET.radius;
        if (dx * dx + dy * dy <= rSum * rSum) hits += 1;
      });
    });
    return hits;
  }

  /** 可変フレームレートの render 側で呼ぶ。fps推移の記録とテキスト表示のみ行う */
  reportFrame(rawFrameDeltaSeconds: number): void {
    this.fpsSampleAccumFrames += 1;
    this.fpsSampleAccumTime += rawFrameDeltaSeconds;

    if (this.fpsSampleAccumTime >= 1) {
      const currentFps = this.fpsSampleAccumFrames / this.fpsSampleAccumTime;
      if (this.elapsedSeconds > 2 && currentFps < this.minFps) {
        // 起動直後(テクスチャ焼き込み・シェーダーコンパイル等)の落ち込みは無視する
        this.minFps = currentFps;
      }
      this.fpsSampleAccumFrames = 0;
      this.fpsSampleAccumTime = 0;

      const totalActive = this.enemyNormalPool.activeCount + this.enemyChargePool.activeCount + this.playerPool.activeCount;
      const minutes = Math.floor(this.elapsedSeconds / 60);
      const seconds = Math.floor(this.elapsedSeconds % 60);
      this.statsText.text =
        `--- T1 stress test ---\n` +
        `elapsed: ${minutes}m${seconds.toString().padStart(2, '0')}s / 5m target\n` +
        `active bullets: ${totalActive} (enemy ${this.enemyNormalPool.activeCount + this.enemyChargePool.activeCount} / player ${this.playerPool.activeCount})\n` +
        `min fps so far: ${Number.isFinite(this.minFps) ? Math.round(this.minFps) : '--'}\n` +
        `collisions this step: ${this.lastCollisionCount}`;
    }
  }

  get activeBulletCount(): number {
    return this.enemyNormalPool.activeCount + this.enemyChargePool.activeCount + this.playerPool.activeCount;
  }
}
