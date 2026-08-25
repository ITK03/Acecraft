import { defineConfig } from 'vite';

// GitHub Pages 配信を想定し、リポジトリ名をベースパスにする。
// ローカル/プレビュー時は環境変数で上書きしないかぎり "/" のまま動く。
const base = process.env.VITE_BASE_PATH ?? '/Acecraft/';

export default defineConfig({
  base,
  build: {
    target: 'es2020',
    // iOS Safari のキャッシュ対策: 常にハッシュ付きファイル名を出す(Vite既定)。
    // Service Worker は Phase 0 では導入しない(常に最新ビルドを表示したいため)。
    assetsInlineLimit: 0,
  },
  server: {
    host: true,
  },
});
