/**
 * 64px ユニフォームグリッドによる空間分割衝突判定。
 * 02_CORE_SPEC.md §11: 「総当たり禁止」「ゲームループ内で新規アロケーション0」に対応。
 *
 * カウンティングソート方式: 毎フレーム rebuild() で全アイテムをセルに再配置するが、
 * 配列はすべて起動時に capacity 分を確保済みで、rebuild() 中に new は一切発生しない。
 *
 * rebuild() は SoA(構造体の配列ではなく配列の構造体)で xs/ys/keys を直接受け取る。
 * オブジェクトやコールバックを介さないことで、呼び出し側も含めて完全にアロケーションを断つ。
 */

export class SpatialGrid {
  private readonly cellSize: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellCount: number;

  // セル [c] の要素は sortedKeys[cellStart[c] .. cellStart[c+1]) に入っている
  private readonly cellStart: Int32Array;
  private readonly cellCursor: Int32Array; // rebuild中の書き込みカーソル(再利用)
  private readonly sortedKeys: Int32Array;
  private readonly itemCellScratch: Int32Array; // rebuild中に各アイテムの所属セルを覚えておく

  constructor(minX: number, minY: number, worldWidth: number, worldHeight: number, cellSize: number, capacity: number) {
    this.cellSize = cellSize;
    this.minX = minX;
    this.minY = minY;
    this.cols = Math.max(1, Math.ceil(worldWidth / cellSize));
    this.rows = Math.max(1, Math.ceil(worldHeight / cellSize));
    this.cellCount = this.cols * this.rows;

    this.cellStart = new Int32Array(this.cellCount + 1);
    this.cellCursor = new Int32Array(this.cellCount);
    this.sortedKeys = new Int32Array(capacity);
    this.itemCellScratch = new Int32Array(capacity);
  }

  private cellIndexOf(x: number, y: number): number {
    let cx = Math.floor((x - this.minX) / this.cellSize);
    let cy = Math.floor((y - this.minY) / this.cellSize);
    if (cx < 0) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  /**
   * xs[0..count) / ys[0..count) / keys[0..count) からグリッドを再構築する。
   * keys には呼び出し側が意味づけした一意な整数(プールの添字など)を渡す。
   */
  rebuild(xs: Float32Array, ys: Float32Array, keys: Int32Array, count: number): void {
    const { cellCount, cellStart, cellCursor, sortedKeys, itemCellScratch } = this;

    cellStart.fill(0);

    // パス1: 各セルに入る件数を数える(cellStart を一時カウンタとして使う)
    for (let i = 0; i < count; i += 1) {
      const cell = this.cellIndexOf(xs[i], ys[i]);
      itemCellScratch[i] = cell;
      cellStart[cell + 1] += 1;
    }

    // 累積和 -> 各セルの開始位置
    for (let c = 0; c < cellCount; c += 1) {
      cellStart[c + 1] += cellStart[c];
      cellCursor[c] = cellStart[c];
    }

    // パス2: 実際に並べる
    for (let i = 0; i < count; i += 1) {
      const cell = itemCellScratch[i];
      const pos = cellCursor[cell];
      sortedKeys[pos] = keys[i];
      cellCursor[cell] += 1;
    }
  }

  /**
   * (x, y) を中心とした半径 radius 以内が触れうるセル群を走査し、各アイテムの key で fn を呼ぶ。
   * fn 自体はここでは何もアロケーションしない(呼び出し側の責務)。
   */
  forEachNear(x: number, y: number, radius: number, fn: (key: number) => void): void {
    const minCx = Math.max(0, Math.floor((x - radius - this.minX) / this.cellSize));
    const maxCx = Math.min(this.cols - 1, Math.floor((x + radius - this.minX) / this.cellSize));
    const minCy = Math.max(0, Math.floor((y - radius - this.minY) / this.cellSize));
    const maxCy = Math.min(this.rows - 1, Math.floor((y + radius - this.minY) / this.cellSize));

    for (let cy = minCy; cy <= maxCy; cy += 1) {
      const rowBase = cy * this.cols;
      for (let cx = minCx; cx <= maxCx; cx += 1) {
        const cell = rowBase + cx;
        const start = this.cellStart[cell];
        const end = this.cellStart[cell + 1];
        for (let p = start; p < end; p += 1) {
          fn(this.sortedKeys[p]);
        }
      }
    }
  }
}
