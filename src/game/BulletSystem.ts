import { Container, Particle, ParticleContainer, type Renderer } from 'pixi.js';
import { Pool, type Poolable } from '../core/Pool';
import { bakeBulletTexture, ENEMY_NORMAL_BULLET, ENEMY_CHARGE_BULLET, PLAYER_BULLET, COUNTER_BULLET, FLARE_BULLET, type BulletVisualConfig } from './BulletTextures';
import balance from '../data/balance.json';

/**
 * 弾システム(本番用)。02_CORE_SPEC.md §4.1 の Bullet 構造体を実装する。
 *
 * 仕様書の Bullet インターフェースには sprite/outlineColor という文字列フィールドがあるが、
 * 本実装では T1 のストレステストで実証済みの「見た目の種類(kind)ごとに ParticleContainer と
 * 焼き込みテクスチャを固定で持つ」方式を採用しているため、それらは kind によって暗黙的に
 * 決まる。pierce/lifetime 等、まだどのモジュールも使わないフィールドは実装せず、
 * 実際に必要になった時点(T4以降)で追加する。
 *
 * enemyNormal / enemyCharge / player の3系統に分割しているのは、
 * 「chargeable は弾の生成時に決まり、寿命中ずっと変わらない」という性質上、
 * 見た目(色)を焼き込みテクスチャで固定でき、ParticleContainer の color を
 * 常に static に保てる(=毎フレームの色更新が一切不要になる)ため。
 */

export interface Bullet extends Poolable {
  faction: 'player' | 'enemy';
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  chargeable: boolean;
  /** 残り貫通回数。0で命中時に消滅、-1は無限貫通(将来のモジュール用) */
  pierce: number;
}

export type BulletKind = 'enemyNormal' | 'enemyCharge' | 'player' | 'counter' | 'flare';
const ALL_KINDS: readonly BulletKind[] = ['enemyNormal', 'enemyCharge', 'player', 'counter', 'flare'];

const OFFSCREEN_MARGIN = 120;
// Particle を隠す(=解放中であることを示す)ためのパーキング座標。位置は dynamic property なので
// これだけでコスト0で非表示にできる(ParticleContainer.update() を呼ぶ必要がない)。
const PARKED_X = -99999;
const PARKED_Y = -99999;

function makeBullet(): Bullet {
  return { active: false, faction: 'enemy', x: 0, y: 0, vx: 0, vy: 0, radius: 0, damage: 0, chargeable: false, pierce: 0 };
}

interface KindEntry {
  pool: Pool<Bullet>;
  particles: Particle[];
  container: ParticleContainer;
  radius: number;
  // update() 内で「今フレーム回収する添字」を貯める使い回しスクラッチ(毎フレーム new しない)
  releaseScratch: Int32Array;
}

function enemyChargeCapacity(): number {
  return Math.round(balance.bullets.maxActiveEnemyBullets * balance.bullets.chargeCapacityRatio);
}
function enemyNormalCapacity(): number {
  return balance.bullets.maxActiveEnemyBullets - enemyChargeCapacity();
}

export class BulletSystem {
  private readonly entries: Record<BulletKind, KindEntry>;
  readonly view = new Container();
  // steerCounterBullets の findTarget コールバック用の使い回しバッファ(毎フレームnewしない)
  private readonly steerTargetScratch = { x: 0, y: 0 };

  constructor(renderer: Renderer) {
    this.entries = {
      enemyNormal: this.makeEntry(renderer, enemyNormalCapacity(), ENEMY_NORMAL_BULLET, 'enemy'),
      enemyCharge: this.makeEntry(renderer, enemyChargeCapacity(), ENEMY_CHARGE_BULLET, 'enemy'),
      player: this.makeEntry(renderer, balance.bullets.maxActivePlayerBullets, PLAYER_BULLET, 'player'),
      counter: this.makeEntry(renderer, balance.bullets.maxActiveCounterBullets, COUNTER_BULLET, 'player'),
      flare: this.makeEntry(renderer, balance.bullets.maxActiveFlareBullets, FLARE_BULLET, 'player'),
    };
    this.view.addChild(
      this.entries.enemyNormal.container,
      this.entries.enemyCharge.container,
      this.entries.player.container,
      this.entries.counter.container,
      this.entries.flare.container,
    );
  }

  private makeEntry(renderer: Renderer, capacity: number, visual: BulletVisualConfig, faction: Bullet['faction']): KindEntry {
    const texture = bakeBulletTexture(renderer, visual);
    const container = new ParticleContainer({ texture });
    const pool = new Pool<Bullet>(capacity, makeBullet);
    const particles: Particle[] = [];
    for (let i = 0; i < capacity; i += 1) {
      const particle = new Particle(texture);
      particle.anchorX = 0.5;
      particle.anchorY = 0.5;
      particle.x = PARKED_X;
      particle.y = PARKED_Y;
      particles.push(particle);
      container.addParticle(particle);
      pool.get(i).faction = faction;
      pool.get(i).radius = visual.radius;
    }
    return { pool, particles, container, radius: visual.radius, releaseScratch: new Int32Array(capacity) };
  }

  spawnPlayerBullet(x: number, y: number, vx: number, vy: number, damage: number): void {
    this.spawn('player', x, y, vx, vy, damage, false);
  }

  spawnEnemyBullet(kind: 'enemyNormal' | 'enemyCharge', x: number, y: number, vx: number, vy: number, damage: number): void {
    this.spawn(kind, x, y, vx, vy, damage, kind === 'enemyCharge');
  }

  /** mod_homingflare用。発射直後は直進で、steerFlareBullets()が毎フレーム進行方向を曲げる */
  spawnFlareBullet(x: number, y: number, vx: number, vy: number, damage: number): void {
    this.spawn('flare', x, y, vx, vy, damage, false);
  }

  /**
   * カウンター弾(吸収した弾の反射)。02_CORE_SPEC.md §3.4「charge の数だけカウンター弾を生成」。
   * 上方向(-90°)を中心に spreadDeg 度の扇の中へ撃つ。1発ずつが強力で見た目も主砲弾より大きく白い。
   * count>1で呼ぶと扇内に均等配置、count===1(長押しストリームでの通常呼び出し)では
   * 扇内のランダムな角度に飛ばす(ユーザーフィードバックで「長押しで少しずつ発射」に変更したため、
   * 1発ずつ呼ばれても毎回同じ中央角度に固まらないようにする)。
   */
  spawnCounterBullets(x: number, y: number, count: number, damagePerBullet: number, speed: number, spreadDeg: number): void {
    const spreadRad = (spreadDeg * Math.PI) / 180;
    for (let i = 0; i < count; i += 1) {
      const t = count > 1 ? i / (count - 1) - 0.5 : Math.random() - 0.5; // -0.5..0.5
      const angle = -Math.PI / 2 + t * spreadRad; // 上方向(-90°)を中心に扇状
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      this.spawn('counter', x, y, vx, vy, damagePerBullet, false);
    }
  }

  /**
   * カウンター弾をわずかに追尾させる(ユーザーフィードバック「若干敵を追尾するように」)。
   * 速さは変えず、進行方向だけを目標へ turnRateRad*dt ずつ曲げる(即座に照準を合わせる
   * ホーミングにはしない = 完全な誘導ではなく「若干」の効果に留める)。
   * minDistance未満まで近づいたら追尾を止める(直進させる)。至近距離まで旋回速度で
   * 曲げ続けると目標の周りをクルクル回り続けてしまう(ユーザーフィードバックで判明した不具合)ため。
   * bulletSystem.update() より前に呼ぶこと(このフレームの移動に反映させるため)。
   */
  steerCounterBullets(
    dt: number,
    turnRateRad: number,
    minDistance: number,
    findTarget: (x: number, y: number, out: { x: number; y: number }) => boolean,
  ): void {
    this.steerKind('counter', dt, turnRateRad, minDistance, findTarget);
  }

  /** mod_homingflare用。挙動はsteerCounterBulletsと同一で、対象弾プールがflareなだけ */
  steerFlareBullets(
    dt: number,
    turnRateRad: number,
    minDistance: number,
    findTarget: (x: number, y: number, out: { x: number; y: number }) => boolean,
  ): void {
    this.steerKind('flare', dt, turnRateRad, minDistance, findTarget);
  }

  private steerKind(
    kind: BulletKind,
    dt: number,
    turnRateRad: number,
    minDistance: number,
    findTarget: (x: number, y: number, out: { x: number; y: number }) => boolean,
  ): void {
    const target = this.steerTargetScratch;
    const minDistanceSq = minDistance * minDistance;
    this.entries[kind].pool.forEachActive((bullet) => {
      if (!findTarget(bullet.x, bullet.y, target)) return;
      const dx = target.x - bullet.x;
      const dy = target.y - bullet.y;
      if (dx * dx + dy * dy < minDistanceSq) return; // 至近距離では旋回させず直進に任せる
      const targetAngle = Math.atan2(dy, dx);
      const currentAngle = Math.atan2(bullet.vy, bullet.vx);
      // -PI..PIに正規化して最短回転方向を選ぶ
      const diff = Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle));
      const maxStep = turnRateRad * dt;
      const step = Math.max(-maxStep, Math.min(maxStep, diff));
      const newAngle = currentAngle + step;
      const speed = Math.sqrt(bullet.vx * bullet.vx + bullet.vy * bullet.vy);
      bullet.vx = Math.cos(newAngle) * speed;
      bullet.vy = Math.sin(newAngle) * speed;
    });
  }

  private spawn(kind: BulletKind, x: number, y: number, vx: number, vy: number, damage: number, chargeable: boolean): void {
    const entry = this.entries[kind];
    const acquired = entry.pool.acquire();
    if (!acquired) return; // 上限到達。02_CORE_SPEC.md §11: 新しい弾を捨てない方針のため単純に諦める(T9で上限を実測調整)
    const { index, item } = acquired;
    item.x = x;
    item.y = y;
    item.vx = vx;
    item.vy = vy;
    item.damage = damage;
    item.chargeable = chargeable;
    item.pierce = 0;
    entry.particles[index].x = x;
    entry.particles[index].y = y;
  }

  /** 固定ステップで呼ぶ。移動・画面外回収・Particle座標同期を行う */
  update(dt: number, worldWidth: number, worldHeight: number): void {
    for (let i = 0; i < ALL_KINDS.length; i += 1) {
      this.updateKind(this.entries[ALL_KINDS[i]], dt, worldWidth, worldHeight);
    }
  }

  private updateKind(entry: KindEntry, dt: number, worldWidth: number, worldHeight: number): void {
    let releaseCount = 0;
    entry.pool.forEachActive((bullet, index) => {
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;

      if (
        bullet.x < -OFFSCREEN_MARGIN ||
        bullet.x > worldWidth + OFFSCREEN_MARGIN ||
        bullet.y < -OFFSCREEN_MARGIN ||
        bullet.y > worldHeight + OFFSCREEN_MARGIN
      ) {
        entry.releaseScratch[releaseCount] = index;
        releaseCount += 1;
        return;
      }

      entry.particles[index].x = bullet.x;
      entry.particles[index].y = bullet.y;
    });
    for (let i = 0; i < releaseCount; i += 1) {
      this.releaseIndex(entry, entry.releaseScratch[i]);
    }
  }

  private releaseIndex(entry: KindEntry, index: number): void {
    entry.particles[index].x = PARKED_X;
    entry.particles[index].y = PARKED_Y;
    entry.pool.release(index);
  }

  /** 命中処理: pierce が尽きていれば解放、残っていれば減らすだけ */
  consumeHit(kind: BulletKind, index: number): void {
    const entry = this.entries[kind];
    const bullet = entry.pool.get(index);
    if (bullet.pierce <= 0) {
      this.releaseIndex(entry, index);
    } else {
      bullet.pierce -= 1;
    }
  }

  /** ドレインに吸収された弾を完全に消滅させる(pierceを問わず即時消滅) */
  absorbEnemyChargeBullet(index: number): void {
    this.releaseIndex(this.entries.enemyCharge, index);
  }

  /** クラフトに命中した敵弾を消滅させる(T4時点ではHPシステム未実装のため見た目だけ消える) */
  consumeCraftHit(kind: 'enemyNormal' | 'enemyCharge', index: number): void {
    this.releaseIndex(this.entries[kind], index);
  }

  /**
   * 画面内の敵弾(通常+チャージ)を全消去する。カウンター用(02_CORE_SPEC.md §3.4)。
   * 高頻度に呼ばれる操作ではないため、消えた弾ごとに onEach(x,y) をコールバックする
   * 設計にしている(呼び出し側はここで演出用の粒子を spawn する)。
   */
  clearAllEnemyBullets(onEach: (x: number, y: number) => void): number {
    return this.clearKind(this.entries.enemyNormal, onEach) + this.clearKind(this.entries.enemyCharge, onEach);
  }

  private clearKind(entry: KindEntry, onEach: (x: number, y: number) => void): number {
    let count = 0;
    entry.pool.forEachActive((bullet, index) => {
      onEach(bullet.x, bullet.y);
      entry.releaseScratch[count] = index;
      count += 1;
    });
    for (let i = 0; i < count; i += 1) {
      this.releaseIndex(entry, entry.releaseScratch[i]);
    }
    return count;
  }

  /** 主砲弾・カウンター弾・フレア弾をまとめて走査する(いずれも自機側の攻撃で、敵/ボスへの命中判定は共通のため) */
  forEachActivePlayerFactionBullet(fn: (bullet: Bullet, kind: 'player' | 'counter' | 'flare', index: number) => void): void {
    this.entries.player.pool.forEachActive((bullet, index) => fn(bullet, 'player', index));
    this.entries.counter.pool.forEachActive((bullet, index) => fn(bullet, 'counter', index));
    this.entries.flare.pool.forEachActive((bullet, index) => fn(bullet, 'flare', index));
  }

  forEachActiveEnemyChargeBullet(fn: (bullet: Bullet, index: number) => void): void {
    this.entries.enemyCharge.pool.forEachActive(fn);
  }

  forEachActiveEnemyBullet(fn: (bullet: Bullet, kind: 'enemyNormal' | 'enemyCharge', index: number) => void): void {
    this.entries.enemyNormal.pool.forEachActive((bullet, index) => fn(bullet, 'enemyNormal', index));
    this.entries.enemyCharge.pool.forEachActive((bullet, index) => fn(bullet, 'enemyCharge', index));
  }

  get activeCount(): number {
    return (
      this.entries.enemyNormal.pool.activeCount +
      this.entries.enemyCharge.pool.activeCount +
      this.entries.player.pool.activeCount +
      this.entries.counter.pool.activeCount
    );
  }

  /** チャージ弾プールの総容量。呼び出し側(DrainFieldの吸収スクラッチ等)のサイズ決めに使う */
  get enemyChargeCapacity(): number {
    return this.entries.enemyCharge.pool.capacity;
  }
}
