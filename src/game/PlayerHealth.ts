/**
 * プレイヤーのHP・残機管理。05_PHASE0_TASKS.md T6「HP・残機3機・撃墜時の交代(1.5秒無敵で復帰)」。
 * Craft(移動の状態機械)とは責務を分け、こちらは「生きているか・何回死ねるか」だけを扱う。
 */
export class PlayerHealth {
  readonly maxHp: number;
  hp: number;
  /** 現在の1機を含めた残り機数。0になった時点でゲームオーバー */
  lives: number;
  private invincibleRemaining = 0;

  constructor(maxHp: number, lives: number) {
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.lives = lives;
  }

  get isInvincible(): boolean {
    return this.invincibleRemaining > 0;
  }

  update(dt: number): void {
    if (this.invincibleRemaining > 0) this.invincibleRemaining -= dt;
  }

  heal(fraction: number): void {
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * fraction);
  }

  /**
   * ダメージを受ける。無敵中は何も起きない(呼び出し側は弾の消滅だけ行えばよい)。
   * 'respawned' を返した場合、呼び出し側は Craft.respawnAt() で機体を初期位置へ戻すこと。
   */
  takeDamage(amount: number, invincibleSeconds: number): 'ok' | 'respawned' | 'gameOver' {
    if (this.lives <= 0) return 'gameOver'; // 既に決着済み。同一フレーム内の多重ヒットで残機を掘り下げない
    if (this.isInvincible) return 'ok';
    this.hp -= amount;
    if (this.hp > 0) return 'ok';

    this.lives -= 1;
    if (this.lives <= 0) return 'gameOver';

    this.hp = this.maxHp;
    this.invincibleRemaining = invincibleSeconds;
    return 'respawned';
  }
}
