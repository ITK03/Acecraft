import { Particle, ParticleContainer, type Renderer } from 'pixi.js';
import { Pool, type Poolable } from '../core/Pool';
import { bakeBulletTexture, type BulletVisualConfig } from './BulletTextures';

/**
 * カウンターで消去された弾を「自機へ飛んでいく粒子」に変換する演出。
 * 02_CORE_SPEC.md §3.5「消える弾は消滅ではなく、小さなスコア粒子に変換して自機に飛ばす」。
 * 一度に最大 maxActiveEnemyBullets 発が同時消去されうるので、その最大数を容量にする。
 */

interface ScoreParticleData extends Poolable {
  startX: number;
  startY: number;
  elapsed: number;
  duration: number;
}

const VISUAL: BulletVisualConfig = {
  radius: 4,
  fillColor: 0xffe9a8,
  outlineColor: 0x1a1020,
  outlineWidth: 1,
};

function easeInQuad(t: number): number {
  return t * t;
}

export class ScoreParticles {
  private readonly pool: Pool<ScoreParticleData>;
  private readonly particles: Particle[] = [];
  private readonly container: ParticleContainer;
  private readonly duration: number;
  readonly view: ParticleContainer;

  constructor(renderer: Renderer, capacity: number, duration: number) {
    this.duration = duration;
    const texture = bakeBulletTexture(renderer, VISUAL);
    // alpha を毎フレーム変化させるため color を dynamic にする(位置と違い既定では static)
    this.container = new ParticleContainer({ texture, dynamicProperties: { position: true, color: true } });
    this.view = this.container;

    this.pool = new Pool<ScoreParticleData>(capacity, () => ({
      active: false,
      startX: 0,
      startY: 0,
      elapsed: 0,
      duration: 0,
    }));

    for (let i = 0; i < capacity; i += 1) {
      const particle = new Particle(texture);
      particle.anchorX = 0.5;
      particle.anchorY = 0.5;
      particle.x = -99999;
      particle.y = -99999;
      this.particles.push(particle);
      this.container.addParticle(particle);
    }
  }

  spawn(x: number, y: number): void {
    const acquired = this.pool.acquire();
    if (!acquired) return; // 容量を超える同時消去は起こらない設計だが、超えても無視するだけで安全
    const { index, item } = acquired;
    item.startX = x;
    item.startY = y;
    item.elapsed = 0;
    item.duration = this.duration;
    this.particles[index].x = x;
    this.particles[index].y = y;
  }

  /** 固定ステップで呼ぶ。targetX/Y は現在のクラフト座標(飛行中に自機が動いても追従する) */
  update(dt: number, targetX: number, targetY: number): void {
    this.pool.forEachActive((particle, index) => {
      particle.elapsed += dt;
      const t = Math.min(1, particle.elapsed / particle.duration);
      const e = easeInQuad(t);
      const view = this.particles[index];
      view.x = particle.startX + (targetX - particle.startX) * e;
      view.y = particle.startY + (targetY - particle.startY) * e;
      view.alpha = 1 - t * 0.3; // 終盤まで見えたまま自機に吸い込まれる

      if (t >= 1) {
        view.x = -99999;
        view.y = -99999;
        this.pool.release(index);
      }
    });
  }
}
