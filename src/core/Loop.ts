/**
 * 固定ステップのゲームループ。
 * 02_CORE_SPEC.md §1: 「弾の移動と衝突判定は必ず固定ステップで回すこと」に対応。
 * requestAnimationFrame の間隔(iOS は可変リフレッシュレートがあり得る)を信用せず、
 * アキュムレータ方式で 1/60 秒刻みの update を必要な回数だけ呼ぶ。
 */

export const FIXED_DT = 1 / 60;

/** アプリ切り替え復帰などでの大ジャンプを防ぐ上限(秒) */
const MAX_FRAME_DELTA = 0.25;

/** 1フレームで update を回しすぎて固まらないようにする上限回数 */
const MAX_STEPS_PER_FRAME = 8;

export interface LoopCallbacks {
  /** 固定ステップで呼ばれる。物理・当たり判定・状態機械はすべてここに書く */
  update: (dt: number) => void;
  /** 可変フレームレートで呼ばれる。描画の補間などに使ってよい */
  render: (alpha: number) => void;
}

export class FixedStepLoop {
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private rafHandle = 0;
  private readonly callbacks: LoopCallbacks;

  constructor(callbacks: LoopCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;

    let frameDelta = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameDelta > MAX_FRAME_DELTA) frameDelta = MAX_FRAME_DELTA;

    this.accumulator += frameDelta;

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.callbacks.update(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
    // 上限に達して切り捨てた場合は蓄積を捨てて連鎖遅延を防ぐ
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    const alpha = this.accumulator / FIXED_DT;
    this.callbacks.render(alpha);

    this.rafHandle = requestAnimationFrame(this.tick);
  };
}
