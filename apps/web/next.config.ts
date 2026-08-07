import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // App Router 預設已啟用，無需額外設定
  // 若需要 standalone 部署（Docker），取消以下註解：
  // output: 'standalone',

  // 允許把建置產物輸出到別的目錄，避免「dev server 正在跑」時 npm run build
  // 與它共用 .next 而互相踩踏（症狀：Compiled successfully 之後
  // 「Cannot find module for page」）。正式部署不設此變數，維持 .next。
  //   例：NEXT_DIST_DIR=.next-build npm run build
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
