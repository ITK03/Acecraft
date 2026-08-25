/**
 * 論理解像度 720x1280 (9:16) を実画面サイズにフィットさせる。
 * 04_TECH_STACK.md §3-8: 100vh を使わず window.innerHeight を resize で拾い直す方針。
 * アスペクト比を保ったままレターボックス表示する。
 */

export const LOGICAL_WIDTH = 720;
export const LOGICAL_HEIGHT = 1280;

export interface ViewportSize {
  width: number;
  height: number;
  scale: number;
}

export function computeViewportSize(): ViewportSize {
  const availW = window.innerWidth;
  const availH = window.innerHeight;
  const scale = Math.min(availW / LOGICAL_WIDTH, availH / LOGICAL_HEIGHT);
  return {
    width: Math.floor(LOGICAL_WIDTH * scale),
    height: Math.floor(LOGICAL_HEIGHT * scale),
    scale,
  };
}
