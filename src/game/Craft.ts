/**
 * 自機(クラフト)の状態機械。02_CORE_SPEC.md §2「クラフト(自機)」に対応。
 *
 * 状態遷移(02_CORE_SPEC.md §2.1 の遷移規則):
 *   MOVE   --[タッチ終了]-->            DRAIN
 *   DRAIN  --[タッチ開始, charge==0]--> MOVE
 *   DRAIN  --[タッチ開始, charge>0]-->  COUNTER
 *   COUNTER --[charge=0まで撃ち切る or 指が離れる]--> MOVE(指接地中) / DRAIN(指が離れている)
 * 起動時の初期状態 = DRAIN(指が触れていないため)。
 *
 * カウンターの発射方式(ユーザーフィードバック「ワンタップで全部出るんじゃなくて長押ししてると
 * 溜めたカウンターが少しずつ出る感じで」):
 *   COUNTER中は streamIntervalSeconds ごとに charge を1減らしながら1発ずつ発射する
 *   (onCounterBulletFire を都度呼ぶ)。charge が自然に0になるか、指を離した瞬間に
 *   終了する(離した時点で残弾は破棄。02_CORE_SPEC.md §3.4「発動後 charge=0」に対応)。
 *   charge の減り方=チャージリングの縮み方になるので、撃ち尽くしていく様子がそのまま見える。
 *
 * T2 時点では吸収システム(T4)もカウンター実処理(T5)も未実装のため charge は常に 0 であり、
 * COUNTER 状態には実質到達しない。ただし状態機械そのものは最終形として実装し、
 * T4/T5 は `charge` を増減させ、COUNTER 発動時のコールバックを差し込むだけで済むようにする。
 *
 * 移動の設計(02_CORE_SPEC.md §2.2):
 *   絶対追従(指の座標=機体座標)にはしない。指が機体を隠してしまうため。
 *   タッチ開始時点の「指と機体の位置関係(オフセット)」を保持し、
 *   指の移動量に dragSensitivity を掛けたものをオフセット越しの目標地点(target)に反映したうえで、
 *   機体は target へ followLerp で毎ステップ補間しながら追いつく(= 弾性のある追従)。
 *   dragSensitivity > 1 は「小さい指の動きで機体が大きく動く」ことを意味する。1.0のままだと
 *   可動域全体を動かすのに指を同じ距離だけ動かす必要があり大変、というフィードバックを受けて追加した
 *   (指が機体を隠さないという原則は保ったまま、体感の操作量だけを軽くする)。
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
  /** COUNTER中、charge を1減らして1発発射するまでの間隔(秒) */
  counterStreamInterval: number;
  bounds: CraftBounds;
  /** 指の移動量に掛ける倍率。1.0超で「小さい指の動きで大きく動ける」感度になる */
  dragSensitivity: number;
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

  /** COUNTER中、次の1発までの残り時間 */
  private counterFireTimer = 0;
  private wasTouching = false;

  /** DRAIN→COUNTER に遷移した瞬間に1回だけ呼ばれる。発動時点の charge(=これから撃つ総数)を渡す */
  onCounterFire?: (charge: number) => void;
  /** COUNTER中、streamIntervalSeconds ごとに1発発射するたびに呼ばれる(charge減算後) */
  onCounterBulletFire?: () => void;

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
      const targetX = this.dragAnchorCraftX + (input.fingerX - this.dragAnchorFingerX) * this.config.dragSensitivity;
      const targetY = this.dragAnchorCraftY + (input.fingerY - this.dragAnchorFingerY) * this.config.dragSensitivity;
      this.x += (targetX - this.x) * this.config.followLerp;
      this.y += (targetY - this.y) * this.config.followLerp;
      this.clampToBounds();

      this.trackedVx = (this.x - prevX) / dt;
      this.trackedVy = (this.y - prevY) / dt;

      if (this.state === 'COUNTER') {
        this.counterFireTimer -= dt;
        if (this.counterFireTimer <= 0 && this.charge > 0) {
          this.counterFireTimer += this.config.counterStreamInterval;
          this.charge -= 1;
          this.onCounterBulletFire?.();
        }
        if (this.charge <= 0 || !input.isTouching) {
          this.charge = 0; // 指を離した時点の残弾は破棄する(発動後charge=0、02_CORE_SPEC.md §3.4)
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
        this.counterFireTimer = 0; // 最初の1発はすぐ出る
        this.dragAnchorFingerX = input.fingerX;
        this.dragAnchorFingerY = input.fingerY;
        this.dragAnchorCraftX = this.x;
        this.dragAnchorCraftY = this.y;
        this.onCounterFire?.(this.charge);
      } else {
        this.enterMove(input.fingerX, input.fingerY);
      }
    } else if (touchEnded && this.state === 'MOVE') {
      this.enterDrain();
    }
    // COUNTER 中にタッチが離れても、update() 内でこのフレームのうちに終了処理される
    // (charge<=0 or !input.isTouching の判定を参照)。
  }

  /**
   * T6: 撃墜からの復帰。指の状態を明示的に渡し、通常のエッジ検出(touchStarted等)を
   * バイパスして即座に正しい状態(MOVE/DRAIN)へ入る。指が押されたまま死亡復帰した場合、
   * 通常のエッジ検出だと「新規タッチ」と認識されず MOVE に入れなくなるため。
   */
  respawnAt(x: number, y: number, input: CraftInput): void {
    this.x = x;
    this.y = y;
    this.charge = 0;
    this.vx = 0;
    this.vy = 0;
    this.trackedVx = 0;
    this.trackedVy = 0;
    this.counterFireTimer = 0;
    if (input.isTouching) {
      this.enterMove(input.fingerX, input.fingerY);
    } else {
      this.state = 'DRAIN';
    }
    this.wasTouching = input.isTouching;
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
