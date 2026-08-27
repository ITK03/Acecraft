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
  return '';
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
      const description =
        stats.orbitCount !== undefined
          ? `周回コア${stats.orbitCount}機。触れた敵弾を防ぐ`
          : `弾数+${stats.bulletCountBonus} 拡散角+${stats.spreadBonusDeg}°`;
      return { kind, id, name: def.name, level: nextLevel, description };
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
    for (const [id, level] of this.chipLevels) {
      const stats = chips[id].levels[level - 1];
      atkBonusPct += stats.atkBonusPct ?? 0;
      fireIntervalReductionPct += stats.fireIntervalReductionPct ?? 0;
      damageTakenReductionPct += stats.damageTakenReductionPct ?? 0;
      counterDamageBonusPct += stats.counterDamageBonusPct ?? 0;
      healBonusPct += stats.healBonusPct ?? 0;
    }

    // 各モジュールは1スロットにつき1種類しか所持できないため、bulletCountBonus等はモジュール間で
    // 足し合わせる(=複数の攻撃系モジュールを持てば加算されていく)。一方orbit系は「所持していれば
    // その値をそのまま使う」性質の値なので、足し合わせず所持モジュールの値をそのまま反映する。
    let bulletCountBonus = 0;
    let spreadBonusDeg = 0;
    let orbitCount = 0;
    let orbitBlockRadius = 0;
    let orbitRadius = 0;
    let orbitSpeedRad = 0;
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
    };
    this.onModifiersChanged?.(this.modifiers);
  }
}
