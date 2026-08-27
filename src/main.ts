import { Application, Container, Graphics } from 'pixi.js';
import { FixedStepLoop } from './core/Loop';
import { LOGICAL_WIDTH, LOGICAL_HEIGHT, CRAFT_MOVE_BOUNDS, computeViewportSize } from './core/Viewport';
import { PointerInput } from './core/Input';
import { DebugOverlay } from './ui/DebugOverlay';
import { StressTest } from './dev/StressTest';
import { Craft } from './game/Craft';
import { CraftView } from './game/CraftView';
import { BulletSystem } from './game/BulletSystem';
import { MainGun, type MainGunConfig } from './game/MainGun';
import { EnemySystem } from './game/EnemySystem';
import { DrainField } from './game/DrainField';
import { ScoreParticles } from './game/ScoreParticles';
import { AudioEngine } from './core/Audio';
import { PlayerHealth } from './game/PlayerHealth';
import { WaveDirector, type StageDef } from './game/WaveDirector';
import { WaveHud } from './ui/WaveHud';
import { BossController } from './game/BossController';
import { BossHud } from './ui/BossHud';
import { Background } from './game/Background';
import { BackgroundToggle } from './ui/BackgroundToggle';
import { LootSystem } from './game/LootSystem';
import { BuildSystem, type StatModifiers, type PickChoice } from './game/BuildSystem';
import { LevelUpModal } from './ui/LevelUpModal';
import { OrbitField } from './game/OrbitField';
import balance from './data/balance.json';
import stage1_1 from './data/stages/1-1.json';

const CRAFT_SPAWN_X = LOGICAL_WIDTH / 2;
const CRAFT_SPAWN_Y = CRAFT_MOVE_BOUNDS.maxY - 80;

/** balance.mainGun の基礎値に BuildSystem の装備補正(modifiers)を適用した実効値を作る */
function computeMainGunConfig(modifiers: StatModifiers): MainGunConfig {
  return {
    fireInterval: balance.mainGun.fireInterval * modifiers.fireIntervalMultiplier,
    bulletSpeed: balance.mainGun.bulletSpeed,
    bulletCount: balance.mainGun.bulletCount + modifiers.bulletCountBonus,
    damage: balance.player.atk * modifiers.atkMultiplier,
    spread: balance.mainGun.spread + modifiers.spreadBonusDeg,
  };
}

// craft-敵弾の衝突判定用スクラッチ(毎フレームnewしない)。1ステップで同時に当たる弾は稀なので小さくてよい。
const CRAFT_HIT_SCRATCH_SIZE = 16;
const craftHitIsCharge = new Uint8Array(CRAFT_HIT_SCRATCH_SIZE);
const craftHitIndex = new Int32Array(CRAFT_HIT_SCRATCH_SIZE);
const craftHitDamage = new Float32Array(CRAFT_HIT_SCRATCH_SIZE);

async function bootstrap(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) throw new Error('#app element not found');

  // iOS Safariはtouch-action:none/overscroll-behavior:noneのCSSだけでは、下スワイプ時に
  // 画面全体がバウンド/スクロールしてしまうことがある(ユーザーフィードバックにより追加)。
  // ドキュメント全体でtouchmoveの既定動作を止める、最後の砦としての対策。
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  const app = new Application();
  await app.init({
    background: '#0a0612',
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    antialias: true,
  });
  host.appendChild(app.canvas);

  // 論理解像度 720x1280 の世界をこの下にぶら下げ、拡大縮小だけで実画面にフィットさせる。
  const world = new Container();
  app.stage.addChild(world);

  // T8: 背景演出 + 常時の減光レイヤー。05_PHASE0_TASKS.md T8 参照。
  // 減光レイヤーは、将来ここに乗る背景がどれだけ明るくても弾が視認できることを保証する土台。
  const background = new Background(app.renderer);
  world.addChild(background.view);
  const dimLayer = new Graphics().rect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT).fill(0x000000);
  world.addChild(dimLayer);
  const backgroundToggle = new BackgroundToggle(host);
  background.setReduced(backgroundToggle.reduced);
  dimLayer.alpha = backgroundToggle.reduced ? balance.visibility.reducedDimAlpha : balance.visibility.dimAlpha;
  backgroundToggle.onChange = (reduced) => {
    background.setReduced(reduced);
    dimLayer.alpha = reduced ? balance.visibility.reducedDimAlpha : balance.visibility.dimAlpha;
  };

  // Phase 0 の土台確認用: プレイフィールドの境界を可視化する仮素材。
  const bounds = new Graphics()
    .rect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT)
    .stroke({ width: 2, color: 0x2a1f3d });
  world.addChild(bounds);

  // T1 弾幕ストレステスト(技術選定ゲート)。05_PHASE0_TASKS.md T1 参照。
  // 常時1000発の永続弾を敷き詰めるため、通常プレイ画面に重ねると実弾が埋もれて
  // 見えなくなる(T5確認時に発覚)。URL に ?stress=1 を付けた時だけ起動する専用モードとし、
  // 通常プレイでは構築すらしない(視覚的なノイズだけでなく負荷もゼロにする)。
  const stressTestEnabled = new URLSearchParams(window.location.search).get('stress') === '1';
  const stressTest = stressTestEnabled ? new StressTest(app.renderer) : null;
  if (stressTest) world.addChild(stressTest.view);

  // T2: 自機(クラフト)の状態機械と入力。02_CORE_SPEC.md §2 参照。
  const craft = new Craft(
    {
      followLerp: balance.craft.followLerp,
      hitRadius: balance.craft.hitRadius.normal,
      // ユーザーフィードバック「通常弾と同じペースで一発ずつ打ってほしい」により、
      // カウンターのストリーム間隔を主砲の連射間隔とそのまま一致させる。
      counterStreamInterval: balance.mainGun.fireInterval,
      bounds: CRAFT_MOVE_BOUNDS,
      dragSensitivity: balance.craft.dragSensitivity,
    },
    CRAFT_SPAWN_X,
    CRAFT_SPAWN_Y,
  );
  const craftView = new CraftView(balance.craft.hitRadius.normal);

  // Phase 1: ローグライト(モジュール/チップ)。02_CORE_SPEC.md §7。装備が変わるたびに
  // mainGun等の実効ステータスを再計算する(onModifiersChangedで配線する。定義は後段)。
  const buildSystem = new BuildSystem();

  // T3: 主砲・自弾・敵。02_CORE_SPEC.md §2.4/§4/§5 参照。
  const bulletSystem = new BulletSystem(app.renderer);
  const mainGun = new MainGun(computeMainGunConfig(buildSystem.modifiers));
  const enemySystem = new EnemySystem();
  // Phase 1: mod_orbit(オービットコア)。未所持(orbitCount===0)の間は描画も判定も何もしない受動的なビュー。
  const orbitField = new OrbitField();

  // T4: ドレイン(吸収)フィールド。02_CORE_SPEC.md §3 参照。
  const drainField = new DrainField(
    {
      radius: balance.drain.radius,
      angleDeg: balance.drain.angleDeg,
      pullSpeed: balance.drain.pullSpeed,
      pullAccel: balance.drain.pullAccel,
      absorbMargin: balance.drain.absorbMargin,
      rampUpSeconds: balance.drain.rampUpSeconds,
      chargeMax: balance.drain.chargeMax,
    },
    bulletSystem.enemyChargeCapacity,
  );

  // T5: スコア粒子(カウンターで消えた弾の演出)と手続き的なSE。
  const scoreParticles = new ScoreParticles(app.renderer, balance.bullets.maxActiveEnemyBullets, balance.counter.particleFlightSeconds);
  const audioEngine = new AudioEngine();
  // iOS Safari 対策: 最初のユーザー操作で必ず AudioContext を unlock する(04_TECH_STACK.md §3-4)。
  app.canvas.addEventListener('pointerdown', () => audioEngine.unlock(), { once: true });

  // Phase 1: 経験値・レベルアップ。02_CORE_SPEC.md §8。
  const lootSystem = new LootSystem(
    app.renderer,
    { xpBase: balance.loot.xpBase, xpGrowthRate: balance.loot.xpGrowthRate, magnetFlightSeconds: balance.loot.magnetFlightSeconds },
    balance.loot.capacity,
  );
  enemySystem.onKill = (x, y, scoreXp) => lootSystem.addXp(x, y, scoreXp);

  const levelUpModal = new LevelUpModal();
  // レベルアップ中はゲームを一時停止して3択UIを出す(02_CORE_SPEC.md §8)。nullでない間は
  // ループのupdateを丸ごと止め、pointerdownのカードタップだけを受け付ける。
  let pendingChoices: readonly PickChoice[] | null = null;
  lootSystem.onLevelUp = (newLevel) => {
    const choices = buildSystem.rollChoices(newLevel);
    if (choices.length === 0) return; // 候補が尽きた(現状の実装済みモジュール/チップを取り切った)場合は何も出さない
    pendingChoices = choices;
    levelUpModal.show(choices);
  };
  buildSystem.onModifiersChanged = (modifiers) => {
    mainGun.applyLoadout(computeMainGunConfig(modifiers));
    orbitField.applyLoadout(modifiers.orbitCount, modifiers.orbitBlockRadius, modifiers.orbitRadius, modifiers.orbitSpeedRad);
  };

  // ヒットストップと画面フラッシュの状態(カウンター発動で駆動)。
  let hitStopRemaining = 0;
  let flashAlpha = 0;
  const screenFlash = new Graphics().rect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT).fill(0xffffff);
  screenFlash.alpha = 0;

  drainField.onAbsorb = (newCharge) => {
    audioEngine.playDrainTick(newCharge, balance.drain.chargeMax);
  };

  // T6: HP・残機・ウェーブ進行。05_PHASE0_TASKS.md T6 参照。
  const playerHealth = new PlayerHealth(balance.player.maxHp, balance.player.lives);
  const waveDirector = new WaveDirector(stage1_1 as StageDef);
  const waveHud = new WaveHud();

  // T7: ボス。全ウェーブクリア後にWaveDirectorから引き継ぐ。05_PHASE0_TASKS.md T7 参照。
  const bossHud = new BossHud();
  let bossController: BossController | null = null;
  let runEnded = false;

  waveDirector.onWaveCleared = (healFraction) => {
    playerHealth.heal(healFraction * buildSystem.modifiers.healMultiplier);
  };
  waveDirector.onStageCleared = () => {
    bossController = new BossController();
    bossController.onDefeated = () => {
      runEnded = true;
      waveHud.showResult('cleared');
    };
    world.addChild(bossController.view);
  };

  // ステージクリア/ゲームオーバー後のタップでリトライ(状態リセットが複雑なため単純にリロードする)。
  app.canvas.addEventListener('pointerdown', () => {
    if (runEnded) window.location.reload();
  });

  // ユーザーフィードバック「ワンタップで全部出るんじゃなくて長押ししてると溜めたカウンターが
  // 少しずつ出る感じで」により、発動の瞬間(ヒットストップ/フラッシュ/音/全消去)と、
  // 弾の発射(streamIntervalSecondsごとに1発、Craft側がタイミングを管理)を分離した。
  // 1発あたりのダメージは発動時に確定させ、ストリーム中はそれを使い回す。
  let pendingDamagePerBullet = 0;
  craft.onCounterFire = (charge) => {
    // 02_CORE_SPEC.md §3.4「charge の数だけカウンター弾を生成」通り、charge=発射数を1:1にした
    // (ユーザーフィードバック)。総ダメージは既存の式のままchargeで均等に割る。
    // atkMultiplier(chip_barrel)とcounterDamageBonus(chip_capacitor)をBuildSystemから反映する。
    const effectiveAtk = balance.player.atk * buildSystem.modifiers.atkMultiplier;
    const totalDamage =
      effectiveAtk * balance.counter.baseRatio * (1 + charge * balance.counter.scale) * (1 + buildSystem.modifiers.counterDamageBonus);
    pendingDamagePerBullet = charge > 0 ? totalDamage / charge : 0;
    if (charge >= balance.counter.clearThreshold) {
      bulletSystem.clearAllEnemyBullets((x, y) => scoreParticles.spawn(x, y));
    }
    hitStopRemaining = balance.counter.hitStopSeconds;
    flashAlpha = 1;
    audioEngine.playCounterBlast(charge, balance.counter.clearThreshold, balance.drain.chargeMax);
  };
  craft.onCounterBulletFire = () => {
    bulletSystem.spawnCounterBullets(craft.x, craft.y, 1, pendingDamagePerBullet, balance.counter.bulletSpeed, balance.counter.spreadDeg);
  };

  // カウンター弾の追尾先探索(ユーザーフィードバック「若干敵を追尾するように」)。
  // 敵とボスの両方から一番近い方を選ぶ。毎フレーム呼ばれうるのでアロケーションしない(out書き込み方式)。
  const homingTurnRateRad = (balance.counter.homingTurnRateDeg * Math.PI) / 180;
  const homingSearchRadiusSq = balance.counter.homingSearchRadius * balance.counter.homingSearchRadius;
  const findCounterBulletTarget = (x: number, y: number, out: { x: number; y: number }): boolean => {
    const foundEnemy = enemySystem.findNearestActiveEnemy(x, y, balance.counter.homingSearchRadius, out);
    if (bossController && bossController.state !== 'entering' && bossController.state !== 'defeated') {
      const dx = bossController.x - x;
      const dy = bossController.y - y;
      const bossDistSq = dx * dx + dy * dy;
      if (bossDistSq <= homingSearchRadiusSq) {
        const enemyDistSq = foundEnemy ? (out.x - x) ** 2 + (out.y - y) ** 2 : Infinity;
        if (bossDistSq < enemyDistSq) {
          out.x = bossController.x;
          out.y = bossController.y;
          return true;
        }
      }
    }
    return foundEnemy;
  };

  // 描画順: 敵 -> 弾 -> スコア粒子 -> XP粒子 -> ドレイン範囲 -> 自機 -> 画面フラッシュ ->
  //         HUD -> レベルアップ3択(最前面、他の全てを覆う)
  world.addChild(enemySystem.view);
  world.addChild(bulletSystem.view);
  world.addChild(scoreParticles.view);
  world.addChild(lootSystem.view);
  world.addChild(drainField.view);
  world.addChild(craftView);
  world.addChild(orbitField.view);
  world.addChild(screenFlash);
  world.addChild(waveHud);
  world.addChild(bossHud);
  world.addChild(levelUpModal);

  // クライアント座標(画面ピクセル) -> 論理座標(720x1280) への変換。
  // world の位置・スケールは resize のたびに変わるため、呼び出し時点の値を毎回読む。
  const toLogical = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = app.canvas.getBoundingClientRect();
    const canvasX = clientX - rect.left;
    const canvasY = clientY - rect.top;
    return {
      x: (canvasX - world.x) / world.scale.x,
      y: (canvasY - world.y) / world.scale.y,
    };
  };
  const pointerInput = new PointerInput(app.canvas as unknown as HTMLElement, toLogical);

  // レベルアップの3択タップ判定。カードに当たれば装備を確定し、一時停止を解除する。
  app.canvas.addEventListener('pointerdown', (e) => {
    if (!pendingChoices) return;
    const p = toLogical(e.clientX, e.clientY);
    const index = levelUpModal.hitTest(p.x, p.y);
    if (index === -1) return;
    buildSystem.applyChoice(pendingChoices[index]);
    pendingChoices = null;
    levelUpModal.hide();
  });

  const debugOverlay = new DebugOverlay();
  app.stage.addChild(debugOverlay);
  // stressTest.hudView は画面座標系(スケールされない)。DebugOverlay の下に重ならないよう配置する。
  if (stressTest) app.stage.addChild(stressTest.hudView);

  function applyViewport(): void {
    const { width, height, scale } = computeViewportSize();
    app.renderer.resize(width, height);
    world.scale.set(scale);
    // 中央寄せ(現状は常にキャンバスいっぱいなので実質 0,0 だが、将来の余白対応のため残す)
    world.x = (width - LOGICAL_WIDTH * scale) / 2;
    world.y = (height - LOGICAL_HEIGHT * scale) / 2;
  }
  applyViewport();

  // iOS Safari は URL バーの出し引きで innerHeight が変動するため resize を都度拾い直す。
  window.addEventListener('resize', applyViewport);
  window.addEventListener('orientationchange', applyViewport);

  // アプリ切り替えからの復帰でループが大ジャンプしないよう、
  // 非表示中はループ自体を止める(Loop.ts の MAX_FRAME_DELTA と二重の安全策)。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      loop.stop();
    } else {
      loop.start();
    }
  });

  const loop = new FixedStepLoop({
    update: (dt) => {
      // 背景はヒットストップ中やリザルト画面でも動き続けてよい(純粋な演出のため最初に更新する)。
      background.update(dt);
      // T5: ヒットストップ中は全システムの更新を止める(0.06秒の「画面が止まる」演出)。
      if (hitStopRemaining > 0) {
        hitStopRemaining -= dt;
        return;
      }
      // T6/T7: ステージクリア/ゲームオーバー後は入力を止めてタップ待ちにする。
      if (runEnded) return;
      // Phase 1: レベルアップ3択の選択待ち中はゲーム全体を一時停止する(02_CORE_SPEC.md §8)。
      if (pendingChoices) return;

      const pointer = pointerInput.current;
      const craftInput = { isTouching: pointer.isDown, fingerX: pointer.x, fingerY: pointer.y };
      craft.update(dt, craftInput);
      playerHealth.update(dt);
      mainGun.update(dt, craft.state, craft.x, craft.y, bulletSystem);
      // ドレインは弾の速度をこのフレーム分書き換えるので、必ず bulletSystem.update() より前に呼ぶ。
      drainField.update(dt, craft, bulletSystem);
      // カウンター弾の追尾も同様に、移動計算(bulletSystem.update)より前に速度の向きを曲げる。
      bulletSystem.steerCounterBullets(dt, homingTurnRateRad, balance.counter.homingMinDistance, findCounterBulletTarget);
      bulletSystem.update(dt, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      enemySystem.update(dt, craft.x, craft.y, bulletSystem);
      // mod_orbitのブロック判定は、素通りした弾がクラフトに当たる判定より先に解決する
      // (このフレームでブロックされた弾はクラフト側の判定に含めない)。
      orbitField.update(dt, craft.x, craft.y, bulletSystem);

      // COUNTER中は02_CORE_SPEC.md §3.4により0.35秒間無敵。以前はここが未実装で、
      // ヒットストップ(0.06秒)を過ぎた残りのCOUNTER時間は普通に被弾していた不具合を修正した。
      if (craft.state !== 'COUNTER') {
        // ドレインに吸収されなかった敵弾(通常弾、またはDRAIN中でなかったチャージ弾)は
        // 素通りせずクラフトに当たる。02_CORE_SPEC.md §3.1「チャージ弾のみが吸引対象」に対応。
        let craftHitCount = 0;
        bulletSystem.forEachActiveEnemyBullet((bullet, kind, index) => {
          if (craftHitCount >= CRAFT_HIT_SCRATCH_SIZE) return;
          const dx = bullet.x - craft.x;
          const dy = bullet.y - craft.y;
          const rSum = craft.hitRadius + bullet.radius;
          if (dx * dx + dy * dy > rSum * rSum) return;
          craftHitIsCharge[craftHitCount] = kind === 'enemyCharge' ? 1 : 0;
          craftHitIndex[craftHitCount] = index;
          craftHitDamage[craftHitCount] = bullet.damage;
          craftHitCount += 1;
        });
        let totalCraftDamage = 0;
        for (let i = 0; i < craftHitCount; i += 1) {
          const kind = craftHitIsCharge[i] === 1 ? 'enemyCharge' : 'enemyNormal';
          bulletSystem.consumeCraftHit(kind, craftHitIndex[i]);
          totalCraftDamage += craftHitDamage[i];
        }
        // 自機と敵本体が直接触れた場合のダメージ(02_CORE_SPEC.md §11「接触25」、これまで未実装だった)。
        // ユーザーフィードバックで追加した近接タイプ(brawler)を機能させるために必須。
        totalCraftDamage += enemySystem.resolveContactWithCraft(craft.x, craft.y, craft.hitRadius);
        // chip_plating(被ダメージ軽減)をここで一括して反映する。
        totalCraftDamage *= buildSystem.modifiers.damageTakenMultiplier;

        if (totalCraftDamage > 0) {
          const result = playerHealth.takeDamage(totalCraftDamage, balance.player.respawnInvincibleSeconds);
          if (result === 'respawned') {
            craft.respawnAt(CRAFT_SPAWN_X, CRAFT_SPAWN_Y, craftInput);
          } else if (result === 'gameOver') {
            waveDirector.failStage();
            runEnded = true;
            waveHud.showResult('failed');
          }
        }
      }

      waveDirector.update(dt, enemySystem);
      if (bossController) {
        bossController.update(dt, craft.x, craft.y, bulletSystem);
        bossController.resolvePlayerBulletHits(bulletSystem);
      }
      scoreParticles.update(dt, craft.x, craft.y);
      lootSystem.update(dt, craft.x, craft.y);
      stressTest?.update(dt);
    },
    render: (_alpha) => {
      craftView.x = craft.x;
      craftView.y = craft.y;
      craftView.setState(craft.state);
      craftView.setCharge(craft.charge, balance.drain.chargeMax);
      waveHud.update(waveDirector.currentWaveNumber, waveDirector.totalWaves, playerHealth.hp, playerHealth.maxHp, playerHealth.lives);
      if (bossController) bossHud.update(bossController.hp / bossController.maxHp);

      const rawFrameDelta = app.ticker.deltaMS / 1000;
      // フラッシュはヒットストップ中も含めて滑らかに減衰させたいので固定ステップではなく描画側で処理する。
      flashAlpha = Math.max(0, flashAlpha - rawFrameDelta / 0.15);
      screenFlash.alpha = flashAlpha * 0.5;

      stressTest?.reportFrame(rawFrameDelta);
      debugOverlay.tick(rawFrameDelta, {
        spriteCount: app.stage.children.length,
        activeBullets: bulletSystem.activeCount,
        activeEnemies: enemySystem.activeCount,
        craftState: craft.state,
        craftCharge: craft.charge,
      });
    },
  });
  loop.start();
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to bootstrap application', err);
});
