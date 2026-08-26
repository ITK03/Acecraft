import type { EnemySystem } from './EnemySystem';

/**
 * ウェーブ進行管理。05_PHASE0_TASKS.md T6。
 * 「そのウェーブ分をすべて出現させ終えた」かつ「敵が1体も残っていない」でウェーブクリアとする
 * (02_CORE_SPEC.md §5.4 clearCondition: killAll)。最終ウェーブをクリアするとステージクリア。
 * WaveDirector 自身は EnemySystem に「1体出せ」と指示するだけで、敵の中身(種類・強さ)には
 * 関与しない。ステージ全体の失敗(プレイヤー全滅)は外部から failStage() で通知してもらう。
 */

export interface WaveDef {
  enemyCount: number;
  spawnInterval: number;
  postWaveHeal: number;
}

export interface StageDef {
  id: string;
  waves: WaveDef[];
}

export type WaveDirectorStatus = 'running' | 'cleared' | 'failed';

export class WaveDirector {
  private readonly stage: StageDef;
  private waveIndex = 0;
  private spawnedInWave = 0;
  private spawnTimer = 0;
  status: WaveDirectorStatus = 'running';

  /** ウェーブクリア時に1回だけ呼ばれる。postWaveHeal(0〜1の割合)を渡す */
  onWaveCleared?: (healFraction: number, clearedWaveIndex: number, totalWaves: number) => void;
  onStageCleared?: () => void;

  constructor(stage: StageDef) {
    this.stage = stage;
    this.spawnTimer = stage.waves[0]?.spawnInterval ?? 0;
  }

  get currentWaveNumber(): number {
    return this.waveIndex + 1;
  }

  get totalWaves(): number {
    return this.stage.waves.length;
  }

  failStage(): void {
    if (this.status === 'running') this.status = 'failed';
  }

  update(dt: number, enemySystem: EnemySystem): void {
    if (this.status !== 'running') return;
    const wave = this.stage.waves[this.waveIndex];
    if (!wave) return;

    if (this.spawnedInWave < wave.enemyCount) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        if (enemySystem.trySpawnWaveEnemy()) {
          this.spawnedInWave += 1;
        }
        this.spawnTimer += wave.spawnInterval;
      }
      return; // まだ出現させ切っていない間はクリア判定しない
    }

    if (enemySystem.activeCount > 0) return; // 出し切ったが、まだ残っている

    // ウェーブクリア
    this.onWaveCleared?.(wave.postWaveHeal, this.currentWaveNumber, this.totalWaves);
    this.waveIndex += 1;
    if (this.waveIndex >= this.stage.waves.length) {
      this.status = 'cleared';
      this.onStageCleared?.();
      return;
    }
    this.spawnedInWave = 0;
    this.spawnTimer = this.stage.waves[this.waveIndex].spawnInterval;
  }
}
