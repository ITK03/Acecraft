/**
 * 自機(クラフト)の状態機械。02_CORE_SPEC.md §2「クラフト(自機)」に対応。
 *
 * 状態遷移(02_CORE_SPEC.md §2.1 の遷移規則):
 *   MOVE   --[タッチ終了]-->            DRAIN
 *   DRAIN  --[タッチ開始, charge==0]--> MOVE
 *   DRAIN  --[タッチ開始, charge>0]-->  COUNTER
 *   COUNTER --[counterDuration経過]-->  MOVE(指接地中) / DRAIN(指が離れている)
 * 起動時の初期状態 = DRAIN(指が触れていないため)。
 *
 * T2 時点では吸収システム(T4)もカウンター実処理(T5)も未実装のため charge は常に 0 であり、
 * COUNTER 状態には実質到達しない。ただし状態機械そのものは最終形として実装し、
 * T4/T5 は `charge` を増減させ、COUNTER 発動時のコールバックを差し込むだけで済むようにする。
 *
 * 移動の設計(02_CORE_SPEC.md §2.2):
 *   絶対追従(指の座標=機体座標)にはしない。指が機体を隠してしまうため。
 *   タッチ開始時点の「指と機体の位置関係(オフセット)」を保持し、
 *   指の移動量をそのままオフセット越しの目標地点(target)に反映したうえで、
 *   機体は target へ followLerp で毎ステップ補間しながら追いつく(= 弾性のある追従)。
 *   これにより「指の移動量を1:1で反映する」ことと「追従を補間で滑らかにする」の両方を満たす。
 */

export type CraftState = 'MOVE' | 'DRAIN' | 'COUNTER';

export interface CraftBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface CraftConfig {
  followLerp: number;
  driftDamping: number;
  hitRadius: number;
  counterDuration: number;
  bounds: CraftBounds;
}

export interface CraftInput {
  isTouching: boolean;
  fingerX: number;
  fingerY: number;
}

export class Craft {
  private readonly config: CraftConfig;

  state: CraftState = 'DRAIN';
  x: number;
  y: number;

  /** T4以降: ドレインで吸収したチャージ弾の数。0の間はCOUNTERへ遷移しない */
  charge = 0;

  private dragAnchorFingerX = 0;
  private dragAnchorFingerY = 0;
  private dragAnchorCraftX = 0;
  private dragAnchorCraftY = 0;

  /** MOVE/COUNTER 中の実測速度。DRAIN へ落ちる瞬間にこれを初速として引き継ぐ */
  private trackedVx = 0;
  private trackedVy = 0;

  /** DRAIN 中に減衰していく速度そのもの */
  private vx = 0;
  private vy = 0;

  private counterElapsed = 0;
  private wasTouching = false;

  get hitRadius(): number {
    return this.config.hitRadius;
  }

  constructor(config: CraftConfig, startX: number, startY: number) {
    this.config = config;
    this.x = startX;
    this.y = startY;
  }

  /** 固定ステップ(1/60秒)で毎回呼ぶ */
  update(dt: number, input: CraftInput): void {
    this.handleEdgeTransitions(input);

    const prevX = this.x;
    const prevY = this.y;

    if (this.state === 'MOVE' || this.state === 'COUNTER') {
      const targetX = this.dragAnchorCraftX + (input.fingerX - this.dragAnchorFingerX);
      const targetY = this.dragAnchorCraftY + (input.fingerY - this.dragAnchorFingerY);
      this.x += (targetX - this.x) * this.config.followLerp;
      this.y += (targetY - this.y) * this.config.followLerp;
      this.clampToBounds();

      this.trackedVx = (this.x - prevX) / dt;
      this.trackedVy = (this.y - prevY) / dt;

      if (this.state === 'COUNTER') {
        this.counterElapsed += dt;
        if (this.counterElapsed >= this.config.counterDuration) {
          this.charge = 0;
          if (input.isTouching) {
            this.enterMove(input.fingerX, input.fingerY);
          } else {
            this.enterDrain();
          }
        }
      }
    } else {
      // DRAIN: 入力を受け付けず、直前の速度を減衰させながら滑って止まる
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vx *= this.config.driftDamping;
      this.vy *= this.config.driftDamping;
      this.clampToBounds();
    }

    this.wasTouching = input.isTouching;
  }

  private handleEdgeTransitions(input: CraftInput): void {
    const touchStarted = input.isTouching && !this.wasTouching;
    const touchEnded = !input.isTouching && this.wasTouching;

    if (touchStarted && this.state === 'DRAIN') {
      if (this.charge > 0) {
        this.state = 'COUNTER';
        this.counterElapsed = 0;
        this.dragAnchorFingerX = input.fingerX;
        this.dragAnchorFingerY = input.fingerY;
        this.dragAnchorCraftX = this.x;
        this.dragAnchorCraftY = this.y;
      } else {
        this.enterMove(input.fingerX, input.fingerY);
      }
    } else if (touchEnded && this.state === 'MOVE') {
      this.enterDrain();
    }
    // COUNTER 中にタッチが離れても、カウンター終了まで遷移は待つ
    // (update() 内の counterElapsed 判定で input.isTouching を見て事後処理する)
  }

  private enterMove(fingerX: number, fingerY: number): void {
    this.state = 'MOVE';
    this.dragAnchorFingerX = fingerX;
    this.dragAnchorFingerY = fingerY;
    this.dragAnchorCraftX = this.x;
    this.dragAnchorCraftY = this.y;
  }

  private enterDrain(): void {
    this.state = 'DRAIN';
    this.vx = this.trackedVx;
    this.vy = this.trackedVy;
  }

  private clampToBounds(): void {
    const b = this.config.bounds;
    if (this.x < b.minX) this.x = b.minX;
    else if (this.x > b.maxX) this.x = b.maxX;
    if (this.y < b.minY) this.y = b.minY;
    else if (this.y > b.maxY) this.y = b.maxY;
  }
}
