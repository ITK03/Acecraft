import { Application, Container, Graphics } from 'pixi.js';
import { FixedStepLoop } from './core/Loop';
import { LOGICAL_WIDTH, LOGICAL_HEIGHT, CRAFT_MOVE_BOUNDS, computeViewportSize } from './core/Viewport';
import { PointerInput } from './core/Input';
import { DebugOverlay } from './ui/DebugOverlay';
import { StressTest } from './dev/StressTest';
import { Craft } from './game/Craft';
import { CraftView } from './game/CraftView';
import { BulletSystem } from './game/BulletSystem';
import { MainGun } from './game/MainGun';
import { EnemySystem } from './game/EnemySystem';
import { DrainField } from './game/DrainField';
import balance from './data/balance.json';

// craft-敵弾の衝突判定用スクラッチ(毎フレームnewしない)。1ステップで同時に当たる弾は稀なので小さくてよい。
const CRAFT_HIT_SCRATCH_SIZE = 16;
const craftHitIsCharge = new Uint8Array(CRAFT_HIT_SCRATCH_SIZE);
const craftHitIndex = new Int32Array(CRAFT_HIT_SCRATCH_SIZE);

async function bootstrap(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) throw new Error('#app element not found');

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

  // Phase 0 の土台確認用: プレイフィールドの境界を可視化する仮素材。
  const bounds = new Graphics()
    .rect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT)
    .stroke({ width: 2, color: 0x2a1f3d });
  world.addChild(bounds);

  // T1 弾幕ストレステスト(技術選定ゲート)。05_PHASE0_TASKS.md T1 参照。
  // T2以降もそのまま並走させ、実機での継続的な負荷検証を兼ねる。
  const stressTest = new StressTest(app.renderer);
  world.addChild(stressTest.view);

  // T2: 自機(クラフト)の状態機械と入力。02_CORE_SPEC.md §2 参照。
  const craft = new Craft(
    {
      followLerp: balance.craft.followLerp,
      driftDamping: balance.craft.driftDamping,
      hitRadius: balance.craft.hitRadius.normal,
      counterDuration: balance.counter.duration,
      bounds: CRAFT_MOVE_BOUNDS,
    },
    LOGICAL_WIDTH / 2,
    CRAFT_MOVE_BOUNDS.maxY - 80,
  );
  const craftView = new CraftView(balance.craft.hitRadius.normal);

  // T3: 主砲・自弾・敵。02_CORE_SPEC.md §2.4/§4/§5 参照。
  const bulletSystem = new BulletSystem(app.renderer);
  const mainGun = new MainGun({
    fireInterval: balance.mainGun.fireInterval,
    bulletSpeed: balance.mainGun.bulletSpeed,
    bulletCount: balance.mainGun.bulletCount,
    damage: balance.player.atk,
    spread: 14,
  });
  const enemySystem = new EnemySystem();

  // T4: ドレイン(吸収)フィールド。02_CORE_SPEC.md §3 参照。
  const drainField = new DrainField({
    radius: balance.drain.radius,
    angleDeg: balance.drain.angleDeg,
    pullSpeed: balance.drain.pullSpeed,
    pullAccel: balance.drain.pullAccel,
    absorbMargin: balance.drain.absorbMargin,
    rampUpSeconds: balance.drain.rampUpSeconds,
    chargeMax: balance.drain.chargeMax,
  });

  // 描画順: 敵 -> 弾 -> 自機(弾が敵の下、自機が最前面に見えるように)
  world.addChild(enemySystem.view);
  world.addChild(bulletSystem.view);
  world.addChild(craftView);

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

  const debugOverlay = new DebugOverlay();
  app.stage.addChild(debugOverlay);
  // stressTest.hudView は画面座標系(スケールされない)。DebugOverlay の下に重ならないよう配置する。
  app.stage.addChild(stressTest.hudView);

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
      const pointer = pointerInput.current;
      craft.update(dt, { isTouching: pointer.isDown, fingerX: pointer.x, fingerY: pointer.y });
      mainGun.update(dt, craft.state, craft.x, craft.y, bulletSystem);
      // ドレインは弾の速度をこのフレーム分書き換えるので、必ず bulletSystem.update() より前に呼ぶ。
      drainField.update(dt, craft, bulletSystem);
      bulletSystem.update(dt, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      enemySystem.update(dt, craft.x, craft.y, bulletSystem);

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
        craftHitCount += 1;
      });
      for (let i = 0; i < craftHitCount; i += 1) {
        bulletSystem.consumeCraftHit(craftHitIsCharge[i] === 1 ? 'enemyCharge' : 'enemyNormal', craftHitIndex[i]);
      }

      stressTest.update(dt);
    },
    render: (_alpha) => {
      craftView.x = craft.x;
      craftView.y = craft.y;
      craftView.setState(craft.state);
      craftView.setCharge(craft.charge, balance.drain.chargeMax);

      const rawFrameDelta = app.ticker.deltaMS / 1000;
      stressTest.reportFrame(rawFrameDelta);
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
