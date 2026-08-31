import modulesData from '../data/modules.json';
import chipsData from '../data/chips.json';

/**
 * ローグライト(モジュール/チップ)。02_CORE_SPEC.md §7。
 * §7.1のスロット数(モジュール4/チップ4)、§7.4の重み付き3択抽選、§7.3の進化ルール
 * (Lv3+必要チップ所持でオーバーモジュールが次の3択に確定で1枠出現)を実装する。
 *
 * 進化(オーバーモジュール)の実装方針: evolvesTo先の "mod_xxx_evo" は modules.json 側で
 * ベースモジュールと全く同じフィールド名(bulletCountBonus等)を使った強化版レベルとして
 * 1件だけ(maxLevel:1)定義する。こうすることで recomputeModifiers() のモジュール集計ループを
 * 一切変更せずに(所持モジュールIDがベースからevoへ置き換わるだけで)効果が反映される。
 * evo側は unlockAtPlayerLevel を意図的に非常に大きい値にして、通常の3択抽選プールには
 * 絶対に出現しないようにしてある(rollChoices内の確定枠経由でのみ出現する)。
 * mod_drone(進化先チップ chip_uplink)だけは、そのチップ自体が未実装のオーバードライブ
 * ゲージ系サブシステムに依存し追加していないため、進化先も定義していない
 * (発生し得ない進化条件を仕込むのは無意味なため)。
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
  strikeAInterval?: number;
  strikeARadius?: number;
  strikeADamage?: number;
  teslaInterval?: number;
  teslaDamage?: number;
  teslaSearchRadius?: number;
  mineInterval?: number;
  mineRadius?: number;
  mineDamage?: number;
  mineDuration?: number;
  droneInterval?: number;
  droneDamage?: number;
  droneSpeed?: number;
  droneSearchRadius?: number;
}
interface ModuleDef {
  name: string;
  maxLevel: number;
  unlockAtPlayerLevel: number;
  tags: string[];
  levels: ModuleLevelStats[];
  /** 02_CORE_SPEC.md §7.3進化ルール用。進化先モジュールID */
  evolvesTo?: string;
  /** 進化に必要なチップID(所持しているだけでよい。レベルは問わない) */
  evolveRequiresChip?: string;
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
  areaRadiusBonusPct?: number;
  trapDurationBonusPct?: number;
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
  /** mod_strike_a(エリアストライク)。interval<=0で未所持扱い、AreaStrike側は何もしない */
  strikeAInterval: number;
  strikeARadius: number;
  strikeADamage: number;
  /** mod_tesla(テスラタレット)。interval<=0で未所持扱い、TeslaTurret側は何もしない */
  teslaInterval: number;
  teslaDamage: number;
  teslaSearchRadius: number;
  /** mod_mine(ドリフトマイン)。interval<=0で未所持扱い、MineField側は何もしない */
  mineInterval: number;
  mineRadius: number;
  mineDamage: number;
  mineDuration: number;
  /** mod_drone(サポートドローン)。interval<=0で未所持扱い、Drone側は何もしない */
  droneInterval: number;
  droneDamage: number;
  droneSpeed: number;
  droneSearchRadius: number;
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
  /** chip_payload: mod_strike_aの半径への乗数(1.0=無補正) */
  areaRadiusMultiplier: number;
  /** chip_hourglass: mod_mineの持続時間への乗数(1.0=無補正) */
  trapDurationMultiplier: number;
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
  strikeAInterval: 0,
  strikeARadius: 0,
  strikeADamage: 0,
  teslaInterval: 0,
  teslaDamage: 0,
  teslaSearchRadius: 0,
  mineInterval: 0,
  mineRadius: 0,
  mineDamage: 0,
  mineDuration: 0,
  droneInterval: 0,
  droneDamage: 0,
  droneSpeed: 0,
  droneSearchRadius: 0,
  drainRadiusMultiplier: 1,
  homingTurnRateMultiplier: 1,
  critChance: 0,
  meleeDamageMultiplier: 1,
  laserWidthMultiplier: 1,
  bounceCountBonus: 0,
  areaRadiusMultiplier: 1,
  trapDurationMultiplier: 1,
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
  if (stats.areaRadiusBonusPct !== undefined) return `範囲攻撃の半径 +${stats.areaRadiusBonusPct}%`;
  if (stats.trapDurationBonusPct !== undefined) return `設置物の持続時間 +${stats.trapDurationBonusPct}%`;
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
  if (stats.strikeAInterval !== undefined) return `${stats.strikeAInterval}秒ごとにランダム地点へ範囲爆撃(威力${stats.strikeADamage})`;
  if (stats.teslaInterval !== undefined) return `${stats.teslaInterval}秒ごとに周囲の敵へ雷撃(威力${stats.teslaDamage})`;
  if (stats.mineInterval !== undefined) return `${stats.mineInterval}秒ごとに機雷を設置。接触で爆発(威力${stats.mineDamage})`;
  if (stats.droneInterval !== undefined) return `自律行動するドローンが${stats.droneInterval}秒ごとに射撃(威力${stats.droneDamage})`;
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
    // 進化(02_CORE_SPEC.md §7.3): 所持モジュールがLv3(maxLevel)に達しており、進化先/必要チップが
    // 定義されていて、かつそのチップを(レベル問わず)所持していれば、次の3択に「オーバーモジュール」を
    // 確定で1枠出す。複数該当しても仕様通り確定枠は1つだけ(最初に見つかったものを採用)。
    let guaranteedEvoId: string | null = null;
    // 進化トリガーとなるチップをまだ所持していない場合、通常抽選での重みを引き上げて
    // 進化を成立させやすくする(§7.4 重み表「進化トリガーになるチップを未所持→2.0」)。
    const evoTriggerChipIds = new Set<string>();
    for (const [id, level] of this.moduleLevels) {
      const def = modules[id];
      if (level < def.maxLevel || !def.evolvesTo || !def.evolveRequiresChip) continue;
      if (this.chipLevels.has(def.evolveRequiresChip)) {
        // 進化条件(Lv3 + チップ所持)を満たしている → 確定枠の対象。
        if (guaranteedEvoId === null) guaranteedEvoId = def.evolvesTo;
      } else {
        // チップ未所持 → まだ進化できないので、そのチップを通常抽選で引きやすくする。
        evoTriggerChipIds.add(def.evolveRequiresChip);
      }
    }

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
      const weight = evoTriggerChipIds.has(id) ? 2.0 : owned === undefined ? 1.2 : 0.9;
      pool.push({ kind: 'chip', id, weight });
    }

    const picks: PickChoice[] = [];
    if (guaranteedEvoId) picks.push(this.describeChoice('module', guaranteedEvoId));
    for (let i = picks.length; i < 3 && pool.length > 0; i += 1) {
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
      // 進化(§7.3): 選択したIDが所持中のいずれかのモジュールの進化先と一致する場合、
      // 元のモジュールをスロットから外し進化後のIDに置き換える(スロットは消費しない)。
      // 進化でない通常の新規/強化ピックでは該当する所持モジュールが無いため何もしない。
      for (const [ownedId] of this.moduleLevels) {
        if (modules[ownedId].evolvesTo === choice.id) {
          this.moduleLevels.delete(ownedId);
          break;
        }
      }
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
    let areaRadiusBonusPct = 0;
    let trapDurationBonusPct = 0;
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
      areaRadiusBonusPct += stats.areaRadiusBonusPct ?? 0;
      trapDurationBonusPct += stats.trapDurationBonusPct ?? 0;
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
    let strikeAInterval = 0;
    let strikeARadius = 0;
    let strikeADamage = 0;
    let teslaInterval = 0;
    let teslaDamage = 0;
    let teslaSearchRadius = 0;
    let mineInterval = 0;
    let mineRadius = 0;
    let mineDamage = 0;
    let mineDuration = 0;
    let droneInterval = 0;
    let droneDamage = 0;
    let droneSpeed = 0;
    let droneSearchRadius = 0;
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
      if (stats.strikeAInterval !== undefined) {
        strikeAInterval = stats.strikeAInterval;
        strikeARadius = stats.strikeARadius ?? 0;
        strikeADamage = stats.strikeADamage ?? 0;
      }
      if (stats.teslaInterval !== undefined) {
        teslaInterval = stats.teslaInterval;
        teslaDamage = stats.teslaDamage ?? 0;
        teslaSearchRadius = stats.teslaSearchRadius ?? 0;
      }
      if (stats.mineInterval !== undefined) {
        mineInterval = stats.mineInterval;
        mineRadius = stats.mineRadius ?? 0;
        mineDamage = stats.mineDamage ?? 0;
        mineDuration = stats.mineDuration ?? 0;
      }
      if (stats.droneInterval !== undefined) {
        droneInterval = stats.droneInterval;
        droneDamage = stats.droneDamage ?? 0;
        droneSpeed = stats.droneSpeed ?? 0;
        droneSearchRadius = stats.droneSearchRadius ?? 0;
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
      strikeAInterval,
      strikeARadius,
      strikeADamage,
      teslaInterval,
      teslaDamage,
      teslaSearchRadius,
      mineInterval,
      mineRadius,
      mineDamage,
      mineDuration,
      droneInterval,
      droneDamage,
      droneSpeed,
      droneSearchRadius,
      drainRadiusMultiplier: 1 + drainRadiusBonusPct / 100,
      homingTurnRateMultiplier: 1 + homingTurnRateBonusPct / 100,
      critChance: critChanceBonusPct / 100,
      meleeDamageMultiplier: 1 + meleeDamageBonusPct / 100,
      laserWidthMultiplier: 1 + laserWidthBonusPct / 100,
      bounceCountBonus,
      areaRadiusMultiplier: 1 + areaRadiusBonusPct / 100,
      trapDurationMultiplier: 1 + trapDurationBonusPct / 100,
    };
    this.onModifiersChanged?.(this.modifiers);
  }
}
