import { Container, Graphics } from 'pixi.js';
import { LOGICAL_WIDTH } from '../core/Viewport';
import type { BulletSystem } from './BulletSystem';
import bossDefs from '../data/bosses.json';

/**
 * ボス戦。05_PHASE0_TASKS.md T7。02_CORE_SPEC.md §6「ボス」。
 *
 * 状態機械: entering -> fighting <-> telegraphing -> (フェーズ境界)stunned -> fighting -> ... -> defeated
 * - entering: 登場演出中。無敵かつ攻撃しない
 * - fighting: 通常パターンを周期的に発射しつつ、大技クールダウンが尽きたら telegraphing へ
 * - telegraphing: 1.0秒の予告(点滅)後、大技(チャージ弾多め)を発射して fighting に戻る
 * - フェーズ境界(HPバー1本分)を割ったら、画面内敵弾を全消去 + 0.5秒の stunned(無防備)
 * - defeated: HP0。以後 update は何もしない
 *
 * 「大技に合わせて溜めて返す」という段取りを作るのが目的なので、
 * 大技は必ずチャージ弾比率を高く(chargeableRate 0.6〜0.7)設定してある。
 */

interface FirePatternDef {
  type: 'ring' | 'spread';
  count: number;
  spreadAngleDeg?: number;
  speed: number;
  chargeableRate: number;
}
interface PhaseDef {
  pattern: FirePatternDef;
  patternCooldown: number;
  bigAttack: FirePatternDef;
  bigAttackInterval: number;
}
interface BossDef {
  hpBars: number;
  hpPerBar: number;
  hitRadius: number;
  entryCutsceneSeconds: number;
  phaseStunSeconds: number;
  telegraphSeconds: number;
  moveSpeed: number;
  phases: PhaseDef[];
}

type BossState = 'entering' | 'fighting' | 'telegraphing' | 'stunned' | 'defeated';

const def = bossDefs.sentinel as BossDef;
const ENTRY_Y = 220;

// resolvePlayerBulletHits用: Pool.forEachActive の走査中に同じプールから release すると
// 密配列(スワップ削除)が壊れるため、命中弾を先に集めてから走査後にまとめて消費する。
const HIT_SCRATCH_SIZE = 32;

export class BossController {
  readonly view = new Container();
  private readonly body: Graphics;
  private readonly telegraphRing: Graphics;

  x = LOGICAL_WIDTH / 2;
  y = -def.hitRadius * 2;
  hp: number;
  readonly maxHp: number;
  state: BossState = 'entering';

  private phaseIndex = 0;
  private lastBarsRemaining: number;
  private timer = 0; // 状態ごとの汎用タイマー(entering/telegraphing/stunnedで使い回す)
  private patternTimer = 0;
  private bigAttackTimer = 0;
  private driftDir = 1;

  private readonly hitBulletScratch = new Int32Array(HIT_SCRATCH_SIZE);

  onDefeated?: () => void;

  constructor() {
    this.maxHp = def.hpBars * def.hpPerBar;
    this.hp = this.maxHp;
    this.lastBarsRemaining = def.hpBars;
    this.timer = def.entryCutsceneSeconds;
    this.patternTimer = def.phases[0].patternCooldown;
    this.bigAttackTimer = def.phases[0].bigAttackInterval;

    this.body = new Graphics();
    this.telegraphRing = new Graphics();
    this.view.addChild(this.body, this.telegraphRing);
    this.redrawBody();
  }

  get barsRemaining(): number {
    return Math.max(0, Math.ceil(this.hp / def.hpPerBar));
  }

  update(dt: number, craftX: number, craftY: number, bulletSystem: BulletSystem): void {
    if (this.state === 'defeated') return;

    switch (this.state) {
      case 'entering': {
        this.y += (ENTRY_Y - this.y) * Math.min(1, dt * 2);
        this.timer -= dt;
        if (this.timer <= 0) this.state = 'fighting';
        break;
      }
      case 'fighting': {
        this.x += this.driftDir * def.moveSpeed * dt;
        if (this.x < 100) this.driftDir = 1;
        else if (this.x > LOGICAL_WIDTH - 100) this.driftDir = -1;

        const phase = def.phases[this.phaseIndex];
        this.patternTimer -= dt;
        if (this.patternTimer <= 0) {
          this.fire(phase.pattern, craftX, craftY, bulletSystem);
          this.patternTimer += phase.patternCooldown;
        }
        this.bigAttackTimer -= dt;
        if (this.bigAttackTimer <= 0) {
          this.state = 'telegraphing';
          this.timer = def.telegraphSeconds;
        }
        break;
      }
      case 'telegraphing': {
        this.timer -= dt;
        if (this.timer <= 0) {
          const phase = def.phases[this.phaseIndex];
          this.fire(phase.bigAttack, craftX, craftY, bulletSystem);
          this.bigAttackTimer = phase.bigAttackInterval;
          this.state = 'fighting';
        }
        break;
      }
      case 'stunned': {
        this.timer -= dt;
        if (this.timer <= 0) this.state = 'fighting';
        break;
      }
    }

    this.redrawBody();
  }

  private fire(p: FirePatternDef, craftX: number, craftY: number, bulletSystem: BulletSystem): void {
    const baseAngle = Math.atan2(craftY - this.y, craftX - this.x);
    for (let i = 0; i < p.count; i += 1) {
      let angle: number;
      if (p.type === 'ring') {
        angle = (i / p.count) * Math.PI * 2;
      } else {
        const spreadRad = ((p.spreadAngleDeg ?? 60) * Math.PI) / 180;
        const t = p.count > 1 ? i / (p.count - 1) - 0.5 : 0;
        angle = baseAngle + t * spreadRad;
      }
      const vx = Math.cos(angle) * p.speed;
      const vy = Math.sin(angle) * p.speed;
      const chargeable = Math.random() < p.chargeableRate;
      bulletSystem.spawnEnemyBullet(chargeable ? 'enemyCharge' : 'enemyNormal', this.x, this.y, vx, vy, 12);
    }
  }

  /** 自弾との衝突判定と消費、ダメージ適用までまとめて行う */
  resolvePlayerBulletHits(bulletSystem: BulletSystem, damage: number): void {
    if (this.state === 'entering' || this.state === 'defeated') return; // 登場中は無敵

    let hitCount = 0;
    bulletSystem.forEachActivePlayerBullet((bullet, index) => {
      if (hitCount >= HIT_SCRATCH_SIZE) return;
      const dx = bullet.x - this.x;
      const dy = bullet.y - this.y;
      const rSum = def.hitRadius + bullet.radius;
      if (dx * dx + dy * dy > rSum * rSum) return;
      this.hitBulletScratch[hitCount] = index;
      hitCount += 1;
    });

    for (let i = 0; i < hitCount; i += 1) {
      bulletSystem.consumeHit('player', this.hitBulletScratch[i]);
      // TSの制御フロー解析は applyDamage() 内での this.state 変化を追えないため型アサーションで比較する
      if ((this.state as BossState) === 'defeated') continue; // 前のヒットで倒れていたら以降は無視
      this.applyDamage(damage, bulletSystem);
    }
  }

  private applyDamage(amount: number, bulletSystem: BulletSystem): void {
    if (this.state === 'entering' || this.state === 'defeated') return;
    this.hp = Math.max(0, this.hp - amount);

    if (this.hp <= 0) {
      this.state = 'defeated';
      this.onDefeated?.();
      return;
    }

    const bars = this.barsRemaining;
    if (bars < this.lastBarsRemaining) {
      this.lastBarsRemaining = bars;
      this.phaseIndex = Math.min(def.phases.length - 1, def.hpBars - bars);
      const phase = def.phases[this.phaseIndex];
      this.patternTimer = phase.patternCooldown;
      this.bigAttackTimer = phase.bigAttackInterval;
      this.state = 'stunned';
      this.timer = def.phaseStunSeconds;
      bulletSystem.clearAllEnemyBullets(() => {}); // フェーズ遷移で画面内敵弾を一掃
    }
  }

  /** カウンターの範囲ダメージ用。命中していればダメージを与えて true を返す */
  applyCounterBurst(x: number, y: number, radius: number, damage: number, bulletSystem: BulletSystem): boolean {
    if (this.state === 'entering' || this.state === 'defeated') return false;
    const dx = this.x - x;
    const dy = this.y - y;
    if (dx * dx + dy * dy > radius * radius) return false;
    this.applyDamage(damage, bulletSystem);
    return true;
  }

  private redrawBody(): void {
    // マゼンタ(#FF3FA4)はチャージ弾専用の色相のため、ボス本体(fighting時)は危険色の橙赤にする(T8 視認性ルール)。
    const color = this.state === 'telegraphing' ? 0xffe9a8 : this.state === 'stunned' ? 0x8f7fbf : 0xff5a3c;
    this.body.clear().circle(0, 0, def.hitRadius).fill(color).stroke({ width: 3, color: 0x1a1020 });
    this.body.x = this.x;
    this.body.y = this.y;

    this.telegraphRing.clear();
    if (this.state === 'telegraphing') {
      const t = 1 - this.timer / def.telegraphSeconds;
      this.telegraphRing.circle(0, 0, def.hitRadius + 10 + t * 30).stroke({ width: 4, color: 0xffe9a8, alpha: 0.6 + t * 0.4 });
      this.telegraphRing.x = this.x;
      this.telegraphRing.y = this.y;
    }
  }
}
