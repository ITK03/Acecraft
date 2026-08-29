import { Container, Graphics } from 'pixi.js';
import { Pool, type Poolable } from '../core/Pool';
import { SpatialGrid } from '../core/SpatialGrid';
import { LOGICAL_WIDTH, LOGICAL_HEIGHT } from '../core/Viewport';
import { encodePlayerFactionKind, decodePlayerFactionKind, type BulletSystem } from './BulletSystem';
import enemyDefs from '../data/enemies.json';
import balance from '../data/balance.json';

/**
 * 敵システム。02_CORE_SPEC.md §5「敵とウェーブ」の最小サブセット。
 * moveScript は straightDown/sineDown、fireScript は aimed/spread の2パターンを実装する
 * (ユーザーフィードバック「敵の行動がワンパターン」を受け、敵種をgrunt/seekerの2種に拡張した)。
 * スポーンのタイミング・構成(いつ・何体)は WaveDirector が管理し、
 * このクラスは trySpawnWaveEnemy() を叩かれたら1体出す、という受動的な役割に徹する。
 * どの種類を出すかはこのクラス内部でラウンドロビンに決める(WaveDirectorは敵の中身を知らない)。
 */

type EnemyTypeId = 'grunt' | 'seeker' | 'brawler';
type MoveScript = 'straightDown' | 'sineDown' | 'chasePlayer';

interface EnemyFireScript {
  pattern: 'aimed' | 'spread';
  count: number;
  spreadAngleDeg?: number;
  speed: number;
  cooldown: number;
  chargeableRate: number;
}

interface EnemyTypeDef {
  hp: number;
  scoreXp: number;
  hitRadius: number;
  wrapAround: boolean;
  moveScript: MoveScript;
  fallSpeed: number;
  sineAmplitude?: number;
  sineFrequency?: number;
  /** chasePlayerのみ: 自機X座標へ毎秒どれだけ近づくか(0〜1に近いほど緩慢) */
  chaseRate?: number;
  /** 自機に直接触れた時のダメージ(02_CORE_SPEC.md §11「接触25」相当) */
  contactDamage: number;
  /** 省略可。brawlerのように弾を撃たず接触のみで戦う敵向け(ユーザーフィードバック「全員弾打ってくるだけ」対策) */
  fireScript?: EnemyFireScript;
  /** fireScriptがある場合の弾のダメージ(02_CORE_SPEC.md §11「雑魚弾12」相当)。contactDamageとは別物 */
  bulletDamage?: number;
}

interface Enemy extends Poolable {
  typeId: EnemyTypeId;
  x: number;
  y: number;
  /** sineDown移動の中心x(wrapAroundで再出現するたびに引き直す) */
  baseX: number;
  /** sineDown移動の位相計算用。出現からの経過秒 */
  age: number;
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
const HP_BAR_WIDTH = 28;
const HP_BAR_HEIGHT = 4;

const defs = enemyDefs as Record<EnemyTypeId, EnemyTypeDef>;
const ENEMY_TYPE_IDS: readonly EnemyTypeId[] = ['grunt', 'seeker', 'brawler'];
// waveでの出現比率(grunt 2 : seeker 1 : brawler 1)。WaveDirectorは中身を知らないのでここで固定する。
const SPAWN_CYCLE: readonly EnemyTypeId[] = ['grunt', 'grunt', 'seeker', 'brawler'];
// マゼンタ/シアン(弾専用)と衝突しない緑・黄緑・錆色でタイプごとに塗り分ける(T8 視認性ルール)。
const ENEMY_COLORS: Record<EnemyTypeId, number> = { grunt: 0x6fbf6f, seeker: 0xbfbf5f, brawler: 0x9f5a3f };
const MAX_HIT_RADIUS = Math.max(...ENEMY_TYPE_IDS.map((id) => defs[id].hitRadius));
const CONTACT_HIT_CAPACITY = 8;
const BEAM_HIT_CAPACITY = 24;
const RADIUS_HIT_CAPACITY = 24;
// mod_bouncer用。命中した敵の周りでどこまで「次の的」を探すか。[設計値]
const BOUNCE_SEARCH_RADIUS = 400;

function makeEnemy(): Enemy {
  return { active: false, typeId: 'grunt', x: 0, y: 0, baseX: 0, age: 0, hp: 0, maxHp: 0, fireCooldown: 0 };
}
function makeEffect(): EffectParticle {
  return { active: false, x: 0, y: 0, life: 0 };
}

export class EnemySystem {
  private readonly capacity: number;
  private readonly pool: Pool<Enemy>;
  private readonly graphics: Graphics[] = [];
  private readonly hpBarGraphics: Graphics[] = [];
  private spawnCounter = 0;

  private readonly grid: SpatialGrid;
  private readonly gridScratchX: Float32Array;
  private readonly gridScratchY: Float32Array;
  private readonly gridScratchKey: Int32Array;

  // resolvePlayerBulletHits用: Pool.forEachActive の走査中に同じプールから release すると
  // 密配列(スワップ削除)が壊れるため、命中した弾の添字を先に集めてから走査後にまとめて消費する。
  // 主砲弾/カウンター弾/フレア弾/ブーメラン弾/バウンサー弾の5種を扱うため、どの弾プールから
  // 消費すべきかもencodePlayerFactionKind/decodePlayerFactionKind(BulletSystem)で記録しておく。
  private readonly hitBulletScratch: Int32Array;
  private readonly hitBulletKindScratch: Uint8Array;
  private readonly hitEnemyScratch: Int32Array;
  private readonly hitDamageScratch: Float32Array;
  // mod_bouncer用。命中した瞬間の弾速(方向は次の的へ向け直すため速さだけ保持する)
  private readonly hitBulletSpeedScratch: Float32Array;
  // findNearestActiveEnemyExcluding の書き込み先(mod_bouncerのbounceBullet呼び出し1回につき使い回す)
  private readonly bounceTargetScratch = { x: 0, y: 0 };
  // resolveContactWithCraft用の同種スクラッチ(接触した敵を先に集めてから走査後にkillEnemyする)
  private readonly contactHitScratch = new Int32Array(CONTACT_HIT_CAPACITY);
  // applyBeamDamage(mod_laser)用の同種スクラッチ(範囲内の敵を先に集めてから走査後にダメージ適用する)
  private readonly beamHitScratch = new Int32Array(BEAM_HIT_CAPACITY);
  // applyRadiusDamage(mod_blade)用の同種スクラッチ
  private readonly radiusHitScratch = new Int32Array(RADIUS_HIT_CAPACITY);

  private readonly effectPool = new Pool<EffectParticle>(EFFECT_CAPACITY, makeEffect);
  private readonly effectGraphics: Graphics[] = [];

  readonly view = new Container();
  private readonly enemyLayer = new Container();
  private readonly effectLayer = new Container();

  /** 敵を倒した(接触キル含む)瞬間に呼ばれる。02_CORE_SPEC.md §8 経験値ドロップ用 */
  onKill?: (x: number, y: number, scoreXp: number) => void;

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
    const maxPlayerFactionBullets =
      balance.bullets.maxActivePlayerBullets +
      balance.bullets.maxActiveCounterBullets +
      balance.bullets.maxActiveFlareBullets +
      balance.bullets.maxActiveBoomerangBullets +
      balance.bullets.maxActiveBouncerBullets;
    this.hitBulletScratch = new Int32Array(maxPlayerFactionBullets);
    this.hitBulletKindScratch = new Uint8Array(maxPlayerFactionBullets);
    this.hitEnemyScratch = new Int32Array(maxPlayerFactionBullets);
    this.hitDamageScratch = new Float32Array(maxPlayerFactionBullets);
    this.hitBulletSpeedScratch = new Float32Array(maxPlayerFactionBullets);

    for (let i = 0; i < this.capacity; i += 1) {
      // 見た目は種類ごとに異なるため、出現時(trySpawnWaveEnemy)に描き直す。ここでは空で確保するだけ。
      const g = new Graphics();
      g.visible = false;
      this.graphics.push(g);
      this.enemyLayer.addChild(g);

      const hpBar = new Graphics();
      hpBar.visible = false;
      this.hpBarGraphics.push(hpBar);
      this.enemyLayer.addChild(hpBar);
    }
    for (let i = 0; i < EFFECT_CAPACITY; i += 1) {
      const g = new Graphics();
      g.visible = false;
      this.effectGraphics.push(g);
      this.effectLayer.addChild(g);
    }

    this.view.addChild(this.enemyLayer, this.effectLayer);
  }

  update(dt: number, craftX: number, craftY: number, bulletSystem: BulletSystem): void {
    this.moveEnemies(dt, craftX);
    this.fireEnemies(dt, craftX, craftY, bulletSystem);
    this.rebuildGrid();
    this.resolvePlayerBulletHits(bulletSystem);
    this.updateEffects(dt);
  }

  /** WaveDirector から呼ばれる。1体出現させ、成功したかを返す(容量上限なら false)。種類は内部で決める */
  trySpawnWaveEnemy(): boolean {
    const typeId = SPAWN_CYCLE[this.spawnCounter % SPAWN_CYCLE.length];
    this.spawnCounter += 1;
    return this.trySpawnEnemy(typeId);
  }

  private trySpawnEnemy(typeId: EnemyTypeId): boolean {
    const acquired = this.pool.acquire();
    if (!acquired) return false; // 上限到達。T9で容量を実測調整する
    const { index, item } = acquired;
    const def = defs[typeId];
    item.typeId = typeId;
    item.baseX = this.randomSpawnX(def);
    item.x = item.baseX;
    item.y = -GRID_MARGIN;
    item.age = 0;
    item.hp = def.hp;
    item.maxHp = def.hp;
    item.fireCooldown = def.fireScript ? Math.random() * def.fireScript.cooldown : 0; // 出現タイミングを散らす

    this.graphics[index]
      .clear()
      .circle(0, 0, def.hitRadius)
      .fill(ENEMY_COLORS[typeId])
      .stroke({ width: 2, color: 0x1a1020 });
    this.graphics[index].visible = true;
    return true;
  }

  private randomSpawnX(def: EnemyTypeDef): number {
    // sineDown は左右に振れるため、振幅分の余白を取って画面外にはみ出さないようにする
    const margin = 40 + (def.moveScript === 'sineDown' ? (def.sineAmplitude ?? 0) : 0);
    const span = Math.max(1, LOGICAL_WIDTH - margin * 2);
    return margin + Math.random() * span;
  }

  private moveEnemies(dt: number, craftX: number): void {
    this.pool.forEachActive((enemy, index) => {
      const def = defs[enemy.typeId];
      enemy.age += dt;
      enemy.y += def.fallSpeed * dt;
      if (def.moveScript === 'sineDown') {
        enemy.x = enemy.baseX + Math.sin(enemy.age * (def.sineFrequency ?? 1)) * (def.sineAmplitude ?? 0);
      } else if (def.moveScript === 'chasePlayer') {
        // 02_CORE_SPEC.md §5.2「プレイヤーX座標に緩慢に追従しながら下降」。弾を撃たない近接タイプ用。
        enemy.x += (craftX - enemy.x) * Math.min(1, (def.chaseRate ?? 1) * dt);
      }
      if (def.wrapAround && enemy.y > LOGICAL_HEIGHT + GRID_MARGIN) {
        enemy.y = -GRID_MARGIN;
        enemy.age = 0;
        enemy.baseX = this.randomSpawnX(def);
        enemy.x = enemy.baseX;
      }
      const g = this.graphics[index];
      g.x = enemy.x;
      g.y = enemy.y;
      this.updateHpBar(index, enemy, def);
    });
  }

  /**
   * ユーザーフィードバック「雑魚敵にHPがないように見える」対策。
   * 満タンの間はノイズになるので隠し、被弾して初めて表示する。
   */
  private updateHpBar(index: number, enemy: Enemy, def: EnemyTypeDef): void {
    const g = this.hpBarGraphics[index];
    const t = Math.max(0, Math.min(1, enemy.hp / enemy.maxHp));
    if (t >= 1) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.clear()
      .rect(-HP_BAR_WIDTH / 2, 0, HP_BAR_WIDTH, HP_BAR_HEIGHT)
      .fill({ color: 0x1a1020, alpha: 0.8 })
      .rect(-HP_BAR_WIDTH / 2, 0, HP_BAR_WIDTH * t, HP_BAR_HEIGHT)
      .fill(0xffe9a8);
    g.x = enemy.x;
    g.y = enemy.y - def.hitRadius - 10;
  }

  /** 02_CORE_SPEC.md §5.3 の aimed/spread パターンを実装する */
  private fireEnemies(dt: number, craftX: number, craftY: number, bulletSystem: BulletSystem): void {
    this.pool.forEachActive((enemy) => {
      const def = defs[enemy.typeId];
      if (!def.fireScript) return; // brawlerのように弾を撃たない敵種
      enemy.fireCooldown -= dt;
      if (enemy.fireCooldown > 0) return;
      enemy.fireCooldown += def.fireScript.cooldown;
      this.fireAt(def.fireScript, def.bulletDamage ?? def.contactDamage, enemy.x, enemy.y, craftX, craftY, bulletSystem);
    });
  }

  private fireAt(
    fs: EnemyFireScript,
    damage: number,
    originX: number,
    originY: number,
    targetX: number,
    targetY: number,
    bulletSystem: BulletSystem,
  ): void {
    const baseAngle = Math.atan2(targetY - originY, targetX - originX);
    const spreadRad = ((fs.spreadAngleDeg ?? 60) * Math.PI) / 180;

    for (let i = 0; i < fs.count; i += 1) {
      let angle = baseAngle;
      if (fs.pattern === 'spread' && fs.count > 1) {
        const t = i / (fs.count - 1) - 0.5; // -0.5..0.5
        angle = baseAngle + t * spreadRad;
      }
      const vx = Math.cos(angle) * fs.speed;
      const vy = Math.sin(angle) * fs.speed;
      const chargeable = Math.random() < fs.chargeableRate;
      bulletSystem.spawnEnemyBullet(chargeable ? 'enemyCharge' : 'enemyNormal', originX, originY, vx, vy, damage);
    }
  }

  /**
   * カウンター弾の追尾用。(x,y)から半径maxDistance以内で最も近いアクティブな敵の座標をoutに
   * 書き込み、見つかれば true を返す(毎フレーム呼ばれうるためoutを使い回してアロケーションを避ける)。
   */
  findNearestActiveEnemy(x: number, y: number, maxDistance: number, out: { x: number; y: number }): boolean {
    let bestDistSq = maxDistance * maxDistance;
    let found = false;
    this.pool.forEachActive((enemy) => {
      const dx = enemy.x - x;
      const dy = enemy.y - y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestDistSq) {
        bestDistSq = distSq;
        out.x = enemy.x;
        out.y = enemy.y;
        found = true;
      }
    });
    return found;
  }

  /**
   * mod_bouncer用。(x,y)から半径maxDistance以内で、excludeIndex(直前に命中した敵)を除いた
   * 最も近いアクティブな敵のpool indexを返す(いなければ-1)。座標はoutに書き込む。
   */
  findNearestActiveEnemyExcluding(x: number, y: number, maxDistance: number, excludeIndex: number, out: { x: number; y: number }): number {
    let bestIndex = -1;
    let bestDistSq = maxDistance * maxDistance;
    this.pool.forEachActive((enemy, index) => {
      if (index === excludeIndex) return;
      const dx = enemy.x - x;
      const dy = enemy.y - y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestDistSq) {
        bestDistSq = distSq;
        bestIndex = index;
        out.x = enemy.x;
        out.y = enemy.y;
      }
    });
    return bestIndex;
  }

  /**
   * mod_strike_s(ピンポイントストライク)用。画面内でHPが最も高いアクティブな敵のpool indexを
   * 返し(いなければ-1)、その座標をoutへ書き込む(演出用。毎フレーム呼ばれる想定ではないため
   * findNearestActiveEnemyほど神経質にアロケーションを避ける必要はないが、同じout方式に揃える)。
   */
  findHighestHpActiveEnemy(out: { x: number; y: number }): number {
    let bestIndex = -1;
    let bestHp = -Infinity;
    this.pool.forEachActive((enemy, index) => {
      if (enemy.hp > bestHp) {
        bestHp = enemy.hp;
        bestIndex = index;
        out.x = enemy.x;
        out.y = enemy.y;
      }
    });
    return bestIndex;
  }

  /** mod_strike_s用。指定した敵へ直接ダメージを与える(弾を介さない単発ダメージ) */
  applyDirectDamage(index: number, damage: number): void {
    const enemy = this.pool.get(index);
    if (!enemy.active) return; // 同フレームで既に別の攻撃に倒されている場合はスキップ
    enemy.hp -= damage;
    if (enemy.hp <= 0) this.killEnemy(index);
  }

  /**
   * mod_laser用。x∈[minX,maxX] かつ y<maxY(自機より上方向)にいるアクティブな敵全員へ
   * damageを与える(貫通ビームなので命中数に制限はない)。killEnemy(pool.release)を
   * 同じPoolのforEachActive走査中に呼べないため、対象を先に集めてから走査後にまとめて処理する。
   */
  applyBeamDamage(minX: number, maxX: number, maxY: number, damage: number): void {
    let hitCount = 0;
    this.pool.forEachActive((enemy, index) => {
      if (hitCount >= this.beamHitScratch.length) return;
      if (enemy.x < minX || enemy.x > maxX || enemy.y > maxY) return;
      this.beamHitScratch[hitCount] = index;
      hitCount += 1;
    });
    for (let i = 0; i < hitCount; i += 1) {
      this.applyDirectDamage(this.beamHitScratch[i], damage);
    }
  }

  /**
   * mod_blade用。(x,y)からradius以内のアクティブな敵全員へdamageを与える(範囲内なら何体でも命中)。
   * applyBeamDamageと同じ理由でPool.forEachActive走査中にkillEnemyを呼べないため、
   * 対象を先に集めてから走査後にまとめて処理する。
   */
  applyRadiusDamage(x: number, y: number, radius: number, damage: number): void {
    const radiusSq = radius * radius;
    let hitCount = 0;
    this.pool.forEachActive((enemy, index) => {
      if (hitCount >= this.radiusHitScratch.length) return;
      const dx = enemy.x - x;
      const dy = enemy.y - y;
      if (dx * dx + dy * dy > radiusSq) return;
      this.radiusHitScratch[hitCount] = index;
      hitCount += 1;
    });
    for (let i = 0; i < hitCount; i += 1) {
      this.applyDirectDamage(this.radiusHitScratch[i], damage);
    }
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
    const queryRadius = MAX_HIT_RADIUS + 24; // 24 = 自弾半径の上限を見込んだ余裕 [設計値]

    // 先に「命中した(弾, 敵)の組」を集めるだけにとどめる。ここで consumeHit(release)してしまうと
    // forEachActivePlayerFactionBullet が内部で回している Pool の密配列(スワップ削除)を
    // 走査中に壊してしまい、同フレームで1件取りこぼす恐れがある(Pool.ts の forEachActive 参照)。
    let hitCount = 0;
    bulletSystem.forEachActivePlayerFactionBullet((bullet, kind, bulletIndex) => {
      if (hitCount >= this.hitBulletScratch.length) return;
      let hitEnemyIndex = -1;
      this.grid.forEachNear(bullet.x, bullet.y, queryRadius, (enemyIndex) => {
        if (hitEnemyIndex !== -1) return; // 1発につき1体まで(貫通はpierceで別途対応)
        const enemy = this.pool.get(enemyIndex);
        const dx = bullet.x - enemy.x;
        const dy = bullet.y - enemy.y;
        const rSum = defs[enemy.typeId].hitRadius + bullet.radius;
        if (dx * dx + dy * dy <= rSum * rSum) hitEnemyIndex = enemyIndex;
      });
      if (hitEnemyIndex === -1) return;
      this.hitBulletScratch[hitCount] = bulletIndex;
      this.hitBulletKindScratch[hitCount] = encodePlayerFactionKind(kind);
      this.hitEnemyScratch[hitCount] = hitEnemyIndex;
      this.hitDamageScratch[hitCount] = bullet.damage;
      this.hitBulletSpeedScratch[hitCount] = Math.sqrt(bullet.vx * bullet.vx + bullet.vy * bullet.vy);
      hitCount += 1;
    });

    for (let i = 0; i < hitCount; i += 1) {
      const enemyIndex = this.hitEnemyScratch[i];
      const enemy = this.pool.get(enemyIndex);
      const kind = decodePlayerFactionKind(this.hitBulletKindScratch[i]);
      const bulletIndex = this.hitBulletScratch[i];
      if (kind === 'bouncer') {
        // mod_bouncer: 消滅させず、命中した敵以外で最も近いアクティブな敵へ方向転換させる。
        // 見つからなければ通常通り消滅させる。
        const nextIndex = this.findNearestActiveEnemyExcluding(enemy.x, enemy.y, BOUNCE_SEARCH_RADIUS, enemyIndex, this.bounceTargetScratch);
        if (nextIndex === -1) {
          bulletSystem.consumeHit(kind, bulletIndex);
        } else {
          const dx = this.bounceTargetScratch.x - enemy.x;
          const dy = this.bounceTargetScratch.y - enemy.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const speed = this.hitBulletSpeedScratch[i];
          bulletSystem.bounceBullet(bulletIndex, (dx / dist) * speed, (dy / dist) * speed);
        }
      } else {
        bulletSystem.consumeHit(kind, bulletIndex);
      }
      if (!enemy.active) continue; // 同フレームで既に別弾に倒されている場合はスキップ
      enemy.hp -= this.hitDamageScratch[i];
      if (enemy.hp <= 0) this.killEnemy(enemyIndex);
    }
  }

  /**
   * 自機と敵本体の接触ダメージ(02_CORE_SPEC.md §11「接触25」)。従来は弾同士の当たり判定しかなく
   * 未実装だった。brawler(弾を撃たない近接タイプ)を機能させるために必須で追加した。
   * 触れた敵は即座に撃破し(ラムアタック)、合計ダメージを返す。呼び出し側でplayerHealthに適用する。
   */
  resolveContactWithCraft(craftX: number, craftY: number, craftHitRadius: number): number {
    let totalDamage = 0;
    let hitCount = 0;
    this.pool.forEachActive((enemy, index) => {
      if (hitCount >= this.contactHitScratch.length) return;
      const def = defs[enemy.typeId];
      const dx = enemy.x - craftX;
      const dy = enemy.y - craftY;
      const rSum = craftHitRadius + def.hitRadius;
      if (dx * dx + dy * dy > rSum * rSum) return;
      this.contactHitScratch[hitCount] = index;
      totalDamage += def.contactDamage;
      hitCount += 1;
    });
    for (let i = 0; i < hitCount; i += 1) {
      this.killEnemy(this.contactHitScratch[i]);
    }
    return totalDamage;
  }

  private killEnemy(index: number): void {
    const enemy = this.pool.get(index);
    const def = defs[enemy.typeId];
    this.spawnEffect(enemy.x, enemy.y, def.hitRadius);
    this.onKill?.(enemy.x, enemy.y, def.scoreXp);
    this.graphics[index].visible = false;
    this.hpBarGraphics[index].visible = false;
    this.pool.release(index);
  }

  private spawnEffect(x: number, y: number, hitRadius: number): void {
    const acquired = this.effectPool.acquire();
    if (!acquired) return;
    const { index, item } = acquired;
    item.x = x;
    item.y = y;
    item.life = EFFECT_DURATION;
    const g = this.effectGraphics[index];
    g.clear().circle(0, 0, hitRadius).stroke({ width: 3, color: 0xffe9a8 });
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
