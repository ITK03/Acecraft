import { Container, Graphics, Sprite, type Renderer, type Texture } from 'pixi.js';
import { LOGICAL_WIDTH, LOGICAL_HEIGHT } from '../core/Viewport';

/**
 * 背景演出。05_PHASE0_TASKS.md T8。
 * 星の流れ + ゆっくり明滅するネビュラで構成する(仮素材)。
 * ネビュラは意図的に明るく明滅させ、常時のせる減光レイヤー(main.ts側)があっても
 * 弾(シアン/マゼンタ)が視認できるかを普段のプレイの中で常に検証できるようにしてある。
 * マゼンタ(#FF3FA4)は弾専用の色相のため、背景では絶対に使わない([設計値])。
 */

const STAR_COUNT = 70;
const NEBULA_COUNT = 3;
const NEBULA_COLORS: readonly number[] = [0x2f4f9f, 0x3f8f9f, 0x6f5faf];
const NEBULA_MARGIN = 220;

interface Star {
  sprite: Sprite;
  speed: number;
}

interface Nebula {
  sprite: Sprite;
  driftX: number;
  driftY: number;
  pulseSpeed: number;
  pulsePhase: number;
  baseAlpha: number;
  baseScale: number;
}

function bakeStarTexture(renderer: Renderer): Texture {
  const gfx = new Graphics().circle(3, 3, 3).fill(0xffffff);
  const texture = renderer.generateTexture({ target: gfx, antialias: true });
  gfx.destroy();
  return texture;
}

function bakeNebulaTexture(renderer: Renderer): Texture {
  const radius = 200;
  const gfx = new Graphics();
  const rings = 8;
  for (let i = rings; i >= 1; i -= 1) {
    const t = i / rings;
    gfx.circle(radius, radius, radius * t).fill({ color: 0xffffff, alpha: (1 - t) * 0.9 });
  }
  const texture = renderer.generateTexture({ target: gfx, antialias: true });
  gfx.destroy();
  return texture;
}

export class Background {
  readonly view = new Container();
  private readonly stars: Star[] = [];
  private readonly nebulas: Nebula[] = [];
  private reduced = false;
  private elapsed = 0;

  constructor(renderer: Renderer) {
    const nebulaTexture = bakeNebulaTexture(renderer);
    const nebulaLayer = new Container();
    for (let i = 0; i < NEBULA_COUNT; i += 1) {
      const sprite = new Sprite(nebulaTexture);
      sprite.anchor.set(0.5);
      sprite.tint = NEBULA_COLORS[i % NEBULA_COLORS.length];
      const baseScale = 0.6 + Math.random() * 0.5;
      const baseAlpha = 0.12 + Math.random() * 0.1;
      sprite.x = Math.random() * LOGICAL_WIDTH;
      sprite.y = Math.random() * LOGICAL_HEIGHT;
      sprite.scale.set(baseScale);
      sprite.alpha = baseAlpha;
      nebulaLayer.addChild(sprite);
      this.nebulas.push({
        sprite,
        driftX: (Math.random() - 0.5) * 8,
        driftY: (Math.random() - 0.5) * 6,
        pulseSpeed: 0.15 + Math.random() * 0.15,
        pulsePhase: Math.random() * Math.PI * 2,
        baseAlpha,
        baseScale,
      });
    }
    this.view.addChild(nebulaLayer);

    const starTexture = bakeStarTexture(renderer);
    const starLayer = new Container();
    for (let i = 0; i < STAR_COUNT; i += 1) {
      const sprite = new Sprite(starTexture);
      sprite.anchor.set(0.5);
      sprite.x = Math.random() * LOGICAL_WIDTH;
      sprite.y = Math.random() * LOGICAL_HEIGHT;
      const depth = 0.4 + Math.random() * 0.6;
      sprite.scale.set(depth);
      sprite.alpha = 0.25 + depth * 0.5;
      starLayer.addChild(sprite);
      this.stars.push({ sprite, speed: 20 + depth * 70 });
    }
    this.view.addChild(starLayer);
  }

  /** 「背景演出を抑える」トグル。ONで明滅ネビュラを隠しアニメーションを止める(負荷そのものを下げる) */
  setReduced(reduced: boolean): void {
    this.reduced = reduced;
    for (const n of this.nebulas) n.sprite.visible = !reduced;
  }

  update(dt: number): void {
    if (this.reduced) return;
    this.elapsed += dt;

    for (const s of this.stars) {
      s.sprite.y += s.speed * dt;
      if (s.sprite.y > LOGICAL_HEIGHT + 4) {
        s.sprite.y = -4;
        s.sprite.x = Math.random() * LOGICAL_WIDTH;
      }
    }

    for (const n of this.nebulas) {
      n.sprite.x += n.driftX * dt;
      n.sprite.y += n.driftY * dt;
      if (n.sprite.x < -NEBULA_MARGIN) n.sprite.x = LOGICAL_WIDTH + NEBULA_MARGIN;
      if (n.sprite.x > LOGICAL_WIDTH + NEBULA_MARGIN) n.sprite.x = -NEBULA_MARGIN;
      if (n.sprite.y < -NEBULA_MARGIN) n.sprite.y = LOGICAL_HEIGHT + NEBULA_MARGIN;
      if (n.sprite.y > LOGICAL_HEIGHT + NEBULA_MARGIN) n.sprite.y = -NEBULA_MARGIN;

      const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * n.pulseSpeed + n.pulsePhase);
      n.sprite.alpha = n.baseAlpha * (0.6 + pulse * 0.8);
      n.sprite.scale.set(n.baseScale * (0.9 + pulse * 0.2));
    }
  }
}
