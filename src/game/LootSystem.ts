import { Particle, ParticleContainer, type Renderer } from 'pixi.js';
import { Pool, type Poolable } from '../core/Pool';
import { bakeBulletTexture, type BulletVisualConfig } from './BulletTextures';

/**
 * 経験値とレベルアップ。02_CORE_SPEC.md §8。
 *
 * - 敵撃破で経験値アイテムをドロップする代わりに、自動回収(磁石)にする
 *   (弾幕STGで経験値を拾いに行かせると、ドレイン待機=静止と回収移動が矛盾するため)
 * - 取得(XP加算・レベル判定)は撃破と同時に確定させ、撃破地点から自機へ飛んでいく
 *   演出(magnetFlightSeconds)はあくまで見た目だけで、演出未完了でもXPは既に加算済み
 * - requiredXp(level) = round(xpBase * xpGrowthRate^level)
 */

export interface LootSystemConfig {
  xpBase: number;
  xpGrowthRate: number;
  magnetFlightSeconds: number;
}

interface XpOrb extends Poolable {
  startX: number;
  startY: number;
  elapsed: number;
}

const VISUAL: BulletVisualConfig = {
  radius: 4,
  fillColor: 0x9fff6f,
  outlineColor: 0x1a1020,
  outlineWidth: 1,
};

function easeInQuad(t: number): number {
  return t * t;
}

export function requiredXp(config: LootSystemConfig, level: number): number {
  return Math.round(config.xpBase * config.xpGrowthRate ** level);
}

export class LootSystem {
  private readonly config: LootSystemConfig;
  private readonly pool: Pool<XpOrb>;
  private readonly particles: Particle[] = [];
  readonly view: ParticleContainer;

  level = 1;
  private xp = 0;

  /** レベルアップの瞬間に1回だけ呼ばれる。呼び出し側でゲームを一時停止し3択UIを出す */
  onLevelUp?: (newLevel: number) => void;

  constructor(renderer: Renderer, config: LootSystemConfig, capacity: number) {
    this.config = config;
    const texture = bakeBulletTexture(renderer, VISUAL);
    this.view = new ParticleContainer({ texture, dynamicProperties: { position: true, color: true } });

    this.pool = new Pool<XpOrb>(capacity, () => ({ active: false, startX: 0, startY: 0, elapsed: 0 }));
    for (let i = 0; i < capacity; i += 1) {
      const particle = new Particle(texture);
      particle.anchorX = 0.5;
      particle.anchorY = 0.5;
      particle.x = -99999;
      particle.y = -99999;
      this.particles.push(particle);
      this.view.addParticle(particle);
    }
  }

  get currentLevelXp(): number {
    return this.xp;
  }

  get xpToNextLevel(): number {
    return requiredXp(this.config, this.level);
  }

  /** 敵撃破時に呼ぶ。演出用の軌道アイテムを1個生成しつつ、XP加算とレベル判定は即座に行う */
  addXp(x: number, y: number, amount: number): void {
    const acquired = this.pool.acquire();
    if (acquired) {
      const { index, item } = acquired;
      item.startX = x;
      item.startY = y;
      item.elapsed = 0;
      this.particles[index].x = x;
      this.particles[index].y = y;
    }

    this.xp += amount;
    while (this.xp >= this.xpToNextLevel) {
      this.xp -= this.xpToNextLevel;
      this.level += 1;
      this.onLevelUp?.(this.level);
    }
  }

  /** 固定ステップで呼ぶ。targetX/Y は現在のクラフト座標(飛行中に自機が動いても追従する) */
  update(dt: number, targetX: number, targetY: number): void {
    this.pool.forEachActive((orb, index) => {
      orb.elapsed += dt;
      const t = Math.min(1, orb.elapsed / this.config.magnetFlightSeconds);
      const e = easeInQuad(t);
      const view = this.particles[index];
      view.x = orb.startX + (targetX - orb.startX) * e;
      view.y = orb.startY + (targetY - orb.startY) * e;
      view.alpha = 1 - t * 0.2;

      if (t >= 1) {
        view.x = -99999;
        view.y = -99999;
        this.pool.release(index);
      }
    });
  }
}
