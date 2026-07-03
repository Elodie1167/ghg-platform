import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // App Router 預設已啟用，無需額外設定
  // 若需要 standalone 部署（Docker），取消以下註解：
  // output: 'standalone',
};

export default nextConfig;
