import { Application, Container, Graphics } from 'pixi.js';
import { FixedStepLoop } from './core/Loop';
import { LOGICAL_WIDTH, LOGICAL_HEIGHT, CRAFT_MOVE_BOUNDS, computeViewportSize } from './core/Viewport';
import { PointerInput } from './core/Input';
import { DebugOverlay } from './ui/DebugOverlay';
import { StressTest } from './dev/StressTest';
import { Craft } from './game/Craft';
import { CraftView } from './game/CraftView';
import balance from './data/balance.json';

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
      stressTest.update(dt);
    },
    render: (_alpha) => {
      craftView.x = craft.x;
      craftView.y = craft.y;
      craftView.setState(craft.state);

      const rawFrameDelta = app.ticker.deltaMS / 1000;
      stressTest.reportFrame(rawFrameDelta);
      debugOverlay.tick(rawFrameDelta, {
        spriteCount: app.stage.children.length,
        activeBullets: stressTest.activeBulletCount,
        craftState: craft.state,
      });
    },
  });
  loop.start();
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to bootstrap application', err);
});
