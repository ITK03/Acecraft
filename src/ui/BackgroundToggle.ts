const STORAGE_KEY = 'acecraft.reducedBackground';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false; // プライベートブラウズ等でstorageが使えない場合は既定(通常)にフォールバックする
  }
}

/**
 * 「背景演出を抑える」トグル。05_PHASE0_TASKS.md T8。
 * Phase 0 では設定メニューを作り込まない方針(同ファイル末尾「やらないこと」参照)のため、
 * 画面隅の単一ボタンのみで完結させる。Pixi のヒットテストとは独立したDOM要素として重ねることで、
 * キャンバス全面を使う自機のドラッグ操作(PointerInput)と干渉しないようにしている。
 */
export class BackgroundToggle {
  private reducedState: boolean;
  private readonly button: HTMLButtonElement;
  onChange?: (reduced: boolean) => void;

  constructor(host: HTMLElement) {
    this.reducedState = readStored();

    this.button = document.createElement('button');
    this.button.type = 'button';
    Object.assign(this.button.style, {
      position: 'fixed',
      right: '8px',
      bottom: '8px',
      zIndex: '10',
      padding: '6px 10px',
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#ffffff',
      background: 'rgba(26, 16, 32, 0.75)',
      border: '1px solid #4a3a5f',
      borderRadius: '6px',
      touchAction: 'manipulation',
    });
    this.button.addEventListener('click', () => this.toggle());
    host.appendChild(this.button);

    this.redraw();
  }

  get reduced(): boolean {
    return this.reducedState;
  }

  private toggle(): void {
    this.reducedState = !this.reducedState;
    try {
      localStorage.setItem(STORAGE_KEY, this.reducedState ? '1' : '0');
    } catch {
      /* 保存できない環境では次回起動時は既定に戻るだけで、今回の挙動には影響しない */
    }
    this.redraw();
    this.onChange?.(this.reducedState);
  }

  private redraw(): void {
    this.button.textContent = this.reducedState ? '背景演出: 抑制中' : '背景演出: 通常';
  }
}
