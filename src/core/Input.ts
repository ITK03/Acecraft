/**
 * タッチ(Pointer Events)入力の正規化。
 * 05_PHASE0_TASKS.md T2: 「マウスでも動くようにする(開発用)」も、
 * touch/mouse/pen を単一API に統合する Pointer Events を使うだけで自動的に満たされる。
 *
 * 座標は呼び出し側が渡す toLogical() でスクリーン座標 -> 論理解像度(720x1280)座標に変換する。
 * 複数指の同時操作はケアしない(本作は常にシングルタッチ操作の弾幕STG)。
 */

export interface PointerState {
  isDown: boolean;
  x: number;
  y: number;
}

export type LogicalCoordConverter = (clientX: number, clientY: number) => { x: number; y: number };

export class PointerInput {
  private readonly target: HTMLElement;
  private readonly toLogical: LogicalCoordConverter;
  private readonly state: PointerState = { isDown: false, x: 0, y: 0 };
  private activePointerId: number | null = null;

  private readonly handleDown: (e: PointerEvent) => void;
  private readonly handleMove: (e: PointerEvent) => void;
  private readonly handleUp: (e: PointerEvent) => void;

  constructor(target: HTMLElement, toLogical: LogicalCoordConverter) {
    this.target = target;
    this.toLogical = toLogical;

    this.handleDown = (e: PointerEvent): void => {
      if (this.activePointerId !== null) return; // 最初の1本だけ追従する
      this.activePointerId = e.pointerId;
      this.target.setPointerCapture(e.pointerId);
      const p = this.toLogical(e.clientX, e.clientY);
      this.state.isDown = true;
      this.state.x = p.x;
      this.state.y = p.y;
    };

    this.handleMove = (e: PointerEvent): void => {
      if (e.pointerId !== this.activePointerId) return;
      const p = this.toLogical(e.clientX, e.clientY);
      this.state.x = p.x;
      this.state.y = p.y;
    };

    this.handleUp = (e: PointerEvent): void => {
      if (e.pointerId !== this.activePointerId) return;
      this.activePointerId = null;
      this.state.isDown = false;
    };

    target.addEventListener('pointerdown', this.handleDown);
    target.addEventListener('pointermove', this.handleMove);
    target.addEventListener('pointerup', this.handleUp);
    target.addEventListener('pointercancel', this.handleUp);
  }

  /** 現在のポインタ状態(論理座標)。呼び出し側は毎フレーム読むだけ(ミューテートしないこと) */
  get current(): Readonly<PointerState> {
    return this.state;
  }

  destroy(): void {
    this.target.removeEventListener('pointerdown', this.handleDown);
    this.target.removeEventListener('pointermove', this.handleMove);
    this.target.removeEventListener('pointerup', this.handleUp);
    this.target.removeEventListener('pointercancel', this.handleUp);
  }
}
