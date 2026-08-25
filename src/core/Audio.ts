/**
 * 手続き的なSE生成。Phase 0 は音源ファイルを持たず、Web Audio API の
 * オシレータで吸引音・カウンター音をその場で合成する(仮素材の音版)。
 *
 * 04_TECH_STACK.md §3-4: iOS Safari は「ユーザー操作を起点にしないと
 * AudioContext が動かない」。unlock() を最初のタッチ(pointerdown)で必ず呼ぶこと。
 * これを忘れると無音のまま手触りを誤判定する。
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private unlocked = false;

  /** 最初のユーザー操作(pointerdown等)で必ず呼ぶ。何度呼んでも安全 */
  unlock(): void {
    if (this.unlocked) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    // iOS Safari は resume() 自体もユーザー操作コンテキスト内での呼び出しが必要
    void this.ctx.resume();
    this.unlocked = true;
  }

  /**
   * 吸引音: charge(1..chargeMax) に応じてピッチを段階的に上げる。
   * 02_CORE_SPEC.md §2.5: 「12段階以上」。charge をそのまま使えば最大30段階出るので十分満たす。
   */
  playDrainTick(charge: number, chargeMax: number): void {
    if (!this.ctx) return;
    const t = Math.max(0, Math.min(1, charge / chargeMax));
    // 1オクターブ強の範囲でピッチを上げる(低音始まり、高音で満タン感を出す)
    const freq = 320 * Math.pow(2, t * 1.2);
    this.playBlip(freq, 0.05, 0.05, 'sine');
  }

  /**
   * カウンター音: charge量で3段階以上の音色に差し替える。
   * 02_CORE_SPEC.md §5「溜めた charge が多いほど重い音に差し替え(3段階以上)」。
   */
  playCounterBlast(charge: number, clearThreshold: number, chargeMax: number): void {
    if (!this.ctx) return;
    if (charge >= chargeMax * 0.8) {
      // 最大帯: 重く長く、低音の衝撃波を伴う
      this.playBlip(180, 0.28, 0.22, 'sawtooth');
      this.playBlip(90, 0.32, 0.28, 'square');
    } else if (charge >= clearThreshold) {
      // 中間帯: しっかりした一撃
      this.playBlip(260, 0.2, 0.16, 'sawtooth');
    } else {
      // 少量帯: 軽い返し
      this.playBlip(420, 0.12, 0.08, 'triangle');
    }
  }

  private playBlip(freq: number, duration: number, gainPeak: number, type: OscillatorType): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }
}
