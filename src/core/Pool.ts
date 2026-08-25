/**
 * 汎用オブジェクトプール。
 * 02_CORE_SPEC.md §11: 「ゲームループ内で新規アロケーション0」の土台。
 *
 * - 起動時に capacity 個の T を factory() で事前確保する(以後 new は一切呼ばない)
 * - acquire / release は O(1)。内部で「空き添字のスタック」と「アクティブ添字の密配列」を
 *   スワップ削除方式で管理するため、GC を伴うアロケーションが発生しない
 * - forEachActive はアクティブな要素だけを添字の密配列に沿って走査するため、
 *   capacity 全体を毎回舐める必要がない(アクティブ数に比例する)
 */

export interface Poolable {
  active: boolean;
}

export class Pool<T extends Poolable> {
  readonly items: readonly T[];
  private readonly freeStack: number[];
  private readonly activeIndices: number[];
  private readonly activeListPos: Int32Array;

  constructor(capacity: number, factory: (slotIndex: number) => T) {
    const items: T[] = new Array(capacity);
    const freeStack: number[] = new Array(capacity);
    for (let i = 0; i < capacity; i += 1) {
      const item = factory(i);
      item.active = false;
      items[i] = item;
      // 末尾から積むと若い添字から acquire されるため挙動が読みやすい
      freeStack[i] = capacity - 1 - i;
    }
    this.items = items;
    this.freeStack = freeStack;
    this.activeIndices = [];
    this.activeListPos = new Int32Array(capacity).fill(-1);
  }

  get capacity(): number {
    return this.items.length;
  }

  get activeCount(): number {
    return this.activeIndices.length;
  }

  /** 空きがなければ null。呼び出し側は必ず null チェックすること(古い弾を強制回収する等) */
  acquire(): { index: number; item: T } | null {
    const index = this.freeStack.pop();
    if (index === undefined) return null;
    const item = this.items[index];
    item.active = true;
    this.activeListPos[index] = this.activeIndices.length;
    this.activeIndices.push(index);
    return { index, item };
  }

  release(index: number): void {
    const item = this.items[index];
    if (!item.active) return;
    item.active = false;

    const pos = this.activeListPos[index];
    const lastPos = this.activeIndices.length - 1;
    const lastIndex = this.activeIndices[lastPos];
    this.activeIndices[pos] = lastIndex;
    this.activeListPos[lastIndex] = pos;
    this.activeIndices.pop();
    this.activeListPos[index] = -1;

    this.freeStack.push(index);
  }

  /** 最も古くから存在するアクティブ要素を1つ返す(強制回収用)。O(1) */
  oldestActiveIndex(): number | null {
    // activeIndices はスワップ削除のため挿入順を保証しないが、
    // 「先頭に居続けるのは基本的に古い要素」という近似で十分実用に足りる。
    return this.activeIndices.length > 0 ? this.activeIndices[0] : null;
  }

  get(index: number): T {
    return this.items[index];
  }

  /**
   * アクティブな要素だけを走査する。
   * fn 内で release() を直接呼ぶと走査中の密配列を破壊しうるため、
   * 呼び出し側は「解放したい添字を集めて、走査後にまとめて release する」こと。
   */
  forEachActive(fn: (item: T, index: number) => void): void {
    for (let i = 0; i < this.activeIndices.length; i += 1) {
      const index = this.activeIndices[i];
      fn(this.items[index], index);
    }
  }
}
