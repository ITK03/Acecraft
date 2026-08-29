import modulesData from '../data/modules.json';
import chipsData from '../data/chips.json';

/**
 * ローグライト(モジュール/チップ)。02_CORE_SPEC.md §7。
 * Phase1着手分。§7.1のスロット数(モジュール4/チップ4)、§7.4の重み付き3択抽選を実装する。
 * §7.3の進化ルール([原作A] Lv3+チップ所持でオーバーモジュール確定枠)は、現状まだ進化先を
 * 持つモジュールを実装していないため未着手(Bullet.pierceと同様、将来のモジュール用に
 * データ構造だけ対応させてある。実装が増えたらここに抽選ロジックを追加する)。
 */

interface ModuleLevelStats {
  bulletCountBonus?: number;
  spreadBonusDeg?: number;
  orbitCount?: number;
  orbitBlockRadius?: number;
  orbitRadius?: number;
  orbitSpeedRad?: number;
  flareInterval?: number;
  flareDamage?: number;
  flareSpeed?: number;
  flareTurnRateRad?: number;
  strikeInterval?: number;
  strikeDamage?: number;
  laserHalfWidth?: number;
  laserDamagePerSecond?: number;
  bladeRadius?: number;
  bladeInterval?: number;
  bladeDamage?: number;
  boomerangInterval?: number;
  boomerangDamage?: number;
  boomerangSpeed?: number;
  boomerangTurnSeconds?: number;
  bouncerInterval?: number;
  bouncerDamage?: number;
  bouncerSpeed?: number;
  bouncerMaxBounces?: number;
}
interface ModuleDef {
  name: string;
  maxLevel: number;
  unlockAtPlayerLevel: number;
  tags: string[];
  levels: ModuleLevelStats[];
}

interface ChipLevelStats {
  atkBonusPct?: number;
  fireIntervalReductionPct?: number;
  damageTakenReductionPct?: number;
  counterDamageBonusPct?: number;
  healBonusPct?: number;
  drainRadiusBonusPct?: number;
  homingTurnRateBonusPct?: number;
  critChanceBonusPct?: number;
  meleeDamageBonusPct?: number;
  laserWidthBonusPct?: number;
  /** chip_elastic用。%ではなく固定加算(+1/2/3) */
  bounceCountBonus?: number;
}
interface ChipDef {
  name: string;
  maxLevel: number;
  unlockAtPlayerLevel: number;
  levels: ChipLevelStats[];
}

// JSONに含む _comment フィールドのぶんインデックスシグネチャと厳密には一致しないため unknown 経由でキャストする。
const modules = modulesData as unknown as Record<string, ModuleDef>;
const chips = chipsData as unknown as Record<string, ChipDef>;

const MODULE_SLOTS = 4;
const CHIP_SLOTS = 4;

export type PickKind = 'module' | 'chip';
export interface PickChoice {
  kind: PickKind;
  id: string;
  name: string;
  /** 選んだ場合に到達するレベル(1=新規獲得, 既存Lv+1=強化) */
  level: number;
  description: string;
}

export interface StatModifiers {
  atkMultiplier: number;
  fireIntervalMultiplier: number;
  damageTakenMultiplier: number;
  /** 加算(0.3 = カウンターダメージ+30%) */
  counterDamageBonus: number;
  healMultiplier: number;
  bulletCountBonus: number;
  spreadBonusDeg: number;
  /** mod_orbit(オービットコア)。未所持なら0で、OrbitField側は何もしない */
  orbitCount: number;
  orbitBlockRadius: number;
  orbitRadius: number;
  orbitSpeedRad: number;
  /** mod_homingflare(ホーミングフレア)。interval<=0で未所持扱い、HomingFlare側は何もしない */
  flareInterval: number;
  flareDamage: number;
  flareSpeed: number;
  flareTurnRateRad: number;
  /** mod_strike_s(ピンポイントストライク)。interval<=0で未所持扱い、PinpointStrike側は何もしない */
  strikeInterval: number;
  strikeDamage: number;
  /** mod_laser(ピアッシングレーザー)。damagePerSecond<=0で未所持扱い、LaserBeam側は何もしない */
  laserHalfWidth: number;
  laserDamagePerSecond: number;
  /** mod_blade(ウイングブレード)。interval<=0で未所持扱い、WingBlade側は何もしない */
  bladeRadius: number;
  bladeInterval: number;
  bladeDamage: number;
  /** mod_boomerang(ブーメラン)。interval<=0で未所持扱い、Boomerang側は何もしない */
  boomerangInterval: number;
  boomerangDamage: number;
  boomerangSpeed: number;
  boomerangTurnSeconds: number;
  /** mod_bouncer(バウンサー)。interval<=0で未所持扱い、Bouncer側は何もしない */
  bouncerInterval: number;
  bouncerDamage: number;
  bouncerSpeed: number;
  bouncerMaxBounces: number;
  /** chip_gravity: ドレイン範囲への乗数(1.0=無補正) */
  drainRadiusMultiplier: number;
  /** chip_seeker: カウンター弾/フレア弾の旋回速度への乗数(1.0=無補正) */
  homingTurnRateMultiplier: number;
  /** chip_targeting: クリティカル発生率(0〜1)。全ダメージ発生源で共通に判定する */
  critChance: number;
  /** chip_edge: mod_bladeのダメージへの乗数(1.0=無補正) */
  meleeDamageMultiplier: number;
  /** chip_lens: mod_laserの幅(halfWidth)への乗数(1.0=無補正) */
  laserWidthMultiplier: number;
  /** chip_elastic: mod_bouncerの最大バウンス回数への固定加算(0=無補正) */
  bounceCountBonus: number;
}

const BASE_MODIFIERS: StatModifiers = {
  atkMultiplier: 1,
  fireIntervalMultiplier: 1,
  damageTakenMultiplier: 1,
  counterDamageBonus: 0,
  healMultiplier: 1,
  bulletCountBonus: 0,
  spreadBonusDeg: 0,
  orbitCount: 0,
  orbitBlockRadius: 0,
  orbitRadius: 0,
  orbitSpeedRad: 0,
  flareInterval: 0,
  flareDamage: 0,
  flareSpeed: 0,
  flareTurnRateRad: 0,
  strikeInterval: 0,
  strikeDamage: 0,
  laserHalfWidth: 0,
  laserDamagePerSecond: 0,
  bladeRadius: 0,
  bladeInterval: 0,
  bladeDamage: 0,
  boomerangInterval: 0,
  boomerangDamage: 0,
  boomerangSpeed: 0,
  boomerangTurnSeconds: 0,
  bouncerInterval: 0,
  bouncerDamage: 0,
  bouncerSpeed: 0,
  bouncerMaxBounces: 0,
  drainRadiusMultiplier: 1,
  homingTurnRateMultiplier: 1,
  critChance: 0,
  meleeDamageMultiplier: 1,
  laserWidthMultiplier: 1,
  bounceCountBonus: 0,
};

interface Candidate {
  kind: PickKind;
  id: string;
  weight: number;
}

function describeChipLevel(stats: ChipLevelStats): string {
  if (stats.atkBonusPct !== undefined) return `ATK +${stats.atkBonusPct}%`;
  if (stats.fireIntervalReductionPct !== undefined) return `攻撃速度 +${stats.fireIntervalReductionPct}%`;
  if (stats.damageTakenReductionPct !== undefined) return `被ダメージ -${stats.damageTakenReductionPct}%`;
  if (stats.counterDamageBonusPct !== undefined) return `カウンター威力 +${stats.counterDamageBonusPct}%`;
  if (stats.healBonusPct !== undefined) return `回復量 +${stats.healBonusPct}%`;
  if (stats.drainRadiusBonusPct !== undefined) return `ドレイン範囲 +${stats.drainRadiusBonusPct}%`;
  if (stats.homingTurnRateBonusPct !== undefined) return `追尾性能 +${stats.homingTurnRateBonusPct}%`;
  if (stats.critChanceBonusPct !== undefined) return `クリティカル率 +${stats.critChanceBonusPct}%`;
  if (stats.meleeDamageBonusPct !== undefined) return `近接ダメージ +${stats.meleeDamageBonusPct}%`;
  if (stats.laserWidthBonusPct !== undefined) return `レーザー幅 +${stats.laserWidthBonusPct}%`;
  if (stats.bounceCountBonus !== undefined) return `跳ね返り回数 +${stats.bounceCountBonus}`;
  return '';
}

function describeModuleLevel(stats: ModuleLevelStats): string {
  if (stats.orbitCount !== undefined) return `周回コア${stats.orbitCount}機。触れた敵弾を防ぐ`;
  if (stats.flareInterval !== undefined) return `${stats.flareInterval}秒ごとに追尾弾を発射(威力${stats.flareDamage})`;
  if (stats.strikeInterval !== undefined) return `${stats.strikeInterval}秒ごとに最もHPの高い敵を爆撃(威力${stats.strikeDamage})`;
  if (stats.laserDamagePerSecond !== undefined) return `貫通レーザー(秒間${stats.laserDamagePerSecond}ダメージ)。触れた敵弾も防ぐ`;
  if (stats.bladeInterval !== undefined) return `${stats.bladeInterval}秒ごとに至近の敵を薙ぐ(威力${stats.bladeDamage})`;
  if (stats.boomerangInterval !== undefined) return `${stats.boomerangInterval}秒ごとにブーメラン弾(威力${stats.boomerangDamage})`;
  if (stats.bouncerInterval !== undefined) return `${stats.bouncerInterval}秒ごとに跳ね返る弾(威力${stats.bouncerDamage})`;
  return `弾数+${stats.bulletCountBonus} 拡散角+${stats.spreadBonusDeg}°`;
}

export class BuildSystem {
  private readonly moduleLevels = new Map<string, number>();
  private readonly chipLevels = new Map<string, number>();
  modifiers: StatModifiers = { ...BASE_MODIFIERS };

  /** 装備が変わって modifiers が更新された直後に呼ばれる */
  onModifiersChanged?: (modifiers: StatModifiers) => void;

  /** レベルアップ時に3択を生成する。02_CORE_SPEC.md §7.4 重み付き抽選(重複なし) */
  rollChoices(playerLevel: number): PickChoice[] {
    const pool: Candidate[] = [];
    // JSONの _comment のような先頭アンダースコアのメタキーは実データではないため除外する。
    for (const id of Object.keys(modules).filter((k) => !k.startsWith('_'))) {
      const def = modules[id];
      if (def.unlockAtPlayerLevel > playerLevel) continue;
      const owned = this.moduleLevels.get(id);
      if (owned !== undefined && owned >= def.maxLevel) continue;
      if (owned === undefined && this.moduleLevels.size >= MODULE_SLOTS) continue;
      pool.push({ kind: 'module', id, weight: owned === undefined ? 1.5 : 1.0 });
    }
    for (const id of Object.keys(chips).filter((k) => !k.startsWith('_'))) {
      const def = chips[id];
      if (def.unlockAtPlayerLevel > playerLevel) continue;
      const owned = this.chipLevels.get(id);
      if (owned !== undefined && owned >= def.maxLevel) continue;
      if (owned === undefined && this.chipLevels.size >= CHIP_SLOTS) continue;
      pool.push({ kind: 'chip', id, weight: owned === undefined ? 1.2 : 0.9 });
    }

    const picks: PickChoice[] = [];
    for (let i = 0; i < 3 && pool.length > 0; i += 1) {
      const totalWeight = pool.reduce((sum, c) => sum + c.weight, 0);
      let roll = Math.random() * totalWeight;
      let chosenIndex = pool.length - 1;
      for (let j = 0; j < pool.length; j += 1) {
        roll -= pool[j].weight;
        if (roll <= 0) {
          chosenIndex = j;
          break;
        }
      }
      const [chosen] = pool.splice(chosenIndex, 1);
      picks.push(this.describeChoice(chosen.kind, chosen.id));
    }
    return picks;
  }

  private describeChoice(kind: PickKind, id: string): PickChoice {
    if (kind === 'module') {
      const def = modules[id];
      const nextLevel = (this.moduleLevels.get(id) ?? 0) + 1;
      const stats = def.levels[nextLevel - 1];
      return { kind, id, name: def.name, level: nextLevel, description: describeModuleLevel(stats) };
    }
    const def = chips[id];
    const nextLevel = (this.chipLevels.get(id) ?? 0) + 1;
    return { kind, id, name: def.name, level: nextLevel, description: describeChipLevel(def.levels[nextLevel - 1]) };
  }

  applyChoice(choice: PickChoice): void {
    if (choice.kind === 'module') {
      this.moduleLevels.set(choice.id, choice.level);
    } else {
      this.chipLevels.set(choice.id, choice.level);
    }
    this.recomputeModifiers();
  }

  private recomputeModifiers(): void {
    let atkBonusPct = 0;
    let fireIntervalReductionPct = 0;
    let damageTakenReductionPct = 0;
    let counterDamageBonusPct = 0;
    let healBonusPct = 0;
    let drainRadiusBonusPct = 0;
    let homingTurnRateBonusPct = 0;
    let critChanceBonusPct = 0;
    let meleeDamageBonusPct = 0;
    let laserWidthBonusPct = 0;
    let bounceCountBonus = 0;
    for (const [id, level] of this.chipLevels) {
      const stats = chips[id].levels[level - 1];
      atkBonusPct += stats.atkBonusPct ?? 0;
      fireIntervalReductionPct += stats.fireIntervalReductionPct ?? 0;
      damageTakenReductionPct += stats.damageTakenReductionPct ?? 0;
      counterDamageBonusPct += stats.counterDamageBonusPct ?? 0;
      healBonusPct += stats.healBonusPct ?? 0;
      drainRadiusBonusPct += stats.drainRadiusBonusPct ?? 0;
      homingTurnRateBonusPct += stats.homingTurnRateBonusPct ?? 0;
      critChanceBonusPct += stats.critChanceBonusPct ?? 0;
      meleeDamageBonusPct += stats.meleeDamageBonusPct ?? 0;
      laserWidthBonusPct += stats.laserWidthBonusPct ?? 0;
      bounceCountBonus += stats.bounceCountBonus ?? 0;
    }

    // 各モジュールは1スロットにつき1種類しか所持できないため、bulletCountBonus等はモジュール間で
    // 足し合わせる(=複数の攻撃系モジュールを持てば加算されていく)。一方orbit/flare系は「所持していれば
    // その値をそのまま使う」性質の値なので、足し合わせず所持モジュールの値をそのまま反映する。
    let bulletCountBonus = 0;
    let spreadBonusDeg = 0;
    let orbitCount = 0;
    let orbitBlockRadius = 0;
    let orbitRadius = 0;
    let orbitSpeedRad = 0;
    let flareInterval = 0;
    let flareDamage = 0;
    let flareSpeed = 0;
    let flareTurnRateRad = 0;
    let strikeInterval = 0;
    let strikeDamage = 0;
    let laserHalfWidth = 0;
    let laserDamagePerSecond = 0;
    let bladeRadius = 0;
    let bladeInterval = 0;
    let bladeDamage = 0;
    let boomerangInterval = 0;
    let boomerangDamage = 0;
    let boomerangSpeed = 0;
    let boomerangTurnSeconds = 0;
    let bouncerInterval = 0;
    let bouncerDamage = 0;
    let bouncerSpeed = 0;
    let bouncerMaxBounces = 0;
    for (const [id, level] of this.moduleLevels) {
      const stats = modules[id].levels[level - 1];
      bulletCountBonus += stats.bulletCountBonus ?? 0;
      spreadBonusDeg += stats.spreadBonusDeg ?? 0;
      if (stats.orbitCount !== undefined) {
        orbitCount = stats.orbitCount;
        orbitBlockRadius = stats.orbitBlockRadius ?? 0;
        orbitRadius = stats.orbitRadius ?? 0;
        orbitSpeedRad = stats.orbitSpeedRad ?? 0;
      }
      if (stats.flareInterval !== undefined) {
        flareInterval = stats.flareInterval;
        flareDamage = stats.flareDamage ?? 0;
        flareSpeed = stats.flareSpeed ?? 0;
        flareTurnRateRad = stats.flareTurnRateRad ?? 0;
      }
      if (stats.strikeInterval !== undefined) {
        strikeInterval = stats.strikeInterval;
        strikeDamage = stats.strikeDamage ?? 0;
      }
      if (stats.laserDamagePerSecond !== undefined) {
        laserDamagePerSecond = stats.laserDamagePerSecond;
        laserHalfWidth = stats.laserHalfWidth ?? 0;
      }
      if (stats.bladeInterval !== undefined) {
        bladeInterval = stats.bladeInterval;
        bladeRadius = stats.bladeRadius ?? 0;
        bladeDamage = stats.bladeDamage ?? 0;
      }
      if (stats.boomerangInterval !== undefined) {
        boomerangInterval = stats.boomerangInterval;
        boomerangDamage = stats.boomerangDamage ?? 0;
        boomerangSpeed = stats.boomerangSpeed ?? 0;
        boomerangTurnSeconds = stats.boomerangTurnSeconds ?? 0;
      }
      if (stats.bouncerInterval !== undefined) {
        bouncerInterval = stats.bouncerInterval;
        bouncerDamage = stats.bouncerDamage ?? 0;
        bouncerSpeed = stats.bouncerSpeed ?? 0;
        bouncerMaxBounces = stats.bouncerMaxBounces ?? 0;
      }
    }

    this.modifiers = {
      atkMultiplier: 1 + atkBonusPct / 100,
      // 攻撃速度+n%は「間隔を(1-n%)倍」に効かせる。下限は撃ちっぱなしにならないよう0.2倍で頭打ち
      fireIntervalMultiplier: Math.max(0.2, 1 - fireIntervalReductionPct / 100),
      damageTakenMultiplier: Math.max(0.1, 1 - damageTakenReductionPct / 100),
      counterDamageBonus: counterDamageBonusPct / 100,
      healMultiplier: 1 + healBonusPct / 100,
      bulletCountBonus,
      spreadBonusDeg,
      orbitCount,
      orbitBlockRadius,
      orbitRadius,
      orbitSpeedRad,
      flareInterval,
      flareDamage,
      flareSpeed,
      flareTurnRateRad,
      strikeInterval,
      strikeDamage,
      laserHalfWidth,
      laserDamagePerSecond,
      bladeRadius,
      bladeInterval,
      bladeDamage,
      boomerangInterval,
      boomerangDamage,
      boomerangSpeed,
      boomerangTurnSeconds,
      bouncerInterval,
      bouncerDamage,
      bouncerSpeed,
      bouncerMaxBounces,
      drainRadiusMultiplier: 1 + drainRadiusBonusPct / 100,
      homingTurnRateMultiplier: 1 + homingTurnRateBonusPct / 100,
      critChance: critChanceBonusPct / 100,
      meleeDamageMultiplier: 1 + meleeDamageBonusPct / 100,
      laserWidthMultiplier: 1 + laserWidthBonusPct / 100,
      bounceCountBonus,
    };
    this.onModifiersChanged?.(this.modifiers);
  }
}
