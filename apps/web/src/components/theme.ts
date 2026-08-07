// 共用配色/樣式常數（原本各自重複於 DashboardClient / ReductionClient）

export const HEADER_BG = '#0C3D2E';

export const SCOPE_COLORS = {
  s1: '#166534',
  s2_loc: '#9ca3af',
  s2_mkt: '#64748b',
  s3: '#c2410c',
} as const;

export const INTENSITY_COLORS = {
  standard: '#0d9488',
  revenue: '#cbd5e1',
} as const;

export const COUNTRY_COLORS: Record<string, string> = {
  TWN: '#166534', CHN: '#c2410c', NVN: '#0d9488', SVN: '#0369a1',
  CAB: '#7c3aed', SLV: '#be123c', BGD: '#a16207', IND: '#4d7c0f',
};

export const DEFAULT_COUNTRY_COLOR = '#64748b';
