import { Graphics, type Renderer, type Texture } from 'pixi.js';

/**
 * 弾のテクスチャを起動時に1度だけ焼き込む(ランタイムでの Graphics 生成はしない)。
 * 02_CORE_SPEC.md §4.4 視認性ルール: 全ての敵弾に暗色2pxアウトラインを必須とする。
 * 色をテクスチャに焼き込んでおくことで、ParticleContainer 側は tint を毎フレーム
 * 更新する必要がなくなり(color を static のまま扱える)、描画コストを最小化できる。
 */
export interface BulletVisualConfig {
  radius: number;
  fillColor: number;
  outlineColor: number;
  outlineWidth: number;
}

export function bakeBulletTexture(renderer: Renderer, config: BulletVisualConfig): Texture {
  const { radius, fillColor, outlineColor, outlineWidth } = config;
  const pad = outlineWidth; // ストロークがはみ出す分の余白
  const size = radius * 2 + pad * 2;
  const center = size / 2;

  const gfx = new Graphics()
    .circle(center, center, radius)
    .fill(fillColor)
    .circle(center, center, radius)
    .stroke({ width: outlineWidth, color: outlineColor, alignment: 0.5 });

  const texture = renderer.generateTexture({ target: gfx, antialias: true });
  gfx.destroy();
  return texture;
}

// 02_CORE_SPEC.md §4.4 の配色規則。半径は [設計値](T9で実測調整)。
export const ENEMY_NORMAL_BULLET: BulletVisualConfig = {
  radius: 7,
  fillColor: 0x7fe8ff,
  outlineColor: 0x1a1020,
  outlineWidth: 2,
};

export const ENEMY_CHARGE_BULLET: BulletVisualConfig = {
  radius: 8,
  fillColor: 0xff3fa4,
  outlineColor: 0x1a1020,
  outlineWidth: 2,
};

// 自機弾の色は仕様書に明記がないため、両者と区別できる暖色を独自に採用する。[設計値]
export const PLAYER_BULLET: BulletVisualConfig = {
  radius: 5,
  fillColor: 0xffe9a8,
  outlineColor: 0x1a1020,
  outlineWidth: 2,
};

// カウンター弾(吸収した弾を反射する強力な弾、02_CORE_SPEC.md §3.4「charge の数だけカウンター弾を
// 生成」)。主砲弾と見分けがつかないというフィードバックを受け、半径を敵とほぼ同等まで大きくし、
// アウトラインも太くして「明らかに特別な弾」と分かるようにした。色はT8の「チャージ状態」の白のまま。
export const COUNTER_BULLET: BulletVisualConfig = {
  radius: 22,
  fillColor: 0xffffff,
  outlineColor: 0x1a1020,
  outlineWidth: 3,
};

// mod_homingflare(ホーミングフレア)の弾。既存の全弾(敵シアン/敵チャージ マゼンタ/自機弾 淡黄/
// カウンター弾 白)と被らない色相として若草色を採用する。[設計値]
export const FLARE_BULLET: BulletVisualConfig = {
  radius: 9,
  fillColor: 0x7dffb0,
  outlineColor: 0x1a1020,
  outlineWidth: 2,
};

// mod_boomerang(ブーメラン)の弾。既存の全弾と被らない色相として琥珀色を採用する。[設計値]
export const BOOMERANG_BULLET: BulletVisualConfig = {
  radius: 10,
  fillColor: 0xffc266,
  outlineColor: 0x1a1020,
  outlineWidth: 2,
};

// mod_bouncer(バウンサー)の弾。既存の全弾と被らない色相として紫を採用する。[設計値]
export const BOUNCER_BULLET: BulletVisualConfig = {
  radius: 9,
  fillColor: 0xc9a0ff,
  outlineColor: 0x1a1020,
  outlineWidth: 2,
};
