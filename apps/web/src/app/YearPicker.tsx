'use client';

import { useRouter } from 'next/navigation';

interface Props {
  years: number[];
  currentYear: number;
  nowYear: number;
}

/** 首頁「選年度再填報」banner 用的年度下拉選單。小型 client island，其餘首頁維持 server render。 */
export default function YearPicker({ years, currentYear, nowYear }: Props) {
  const router = useRouter();
  return (
    <select
      value={currentYear}
      onChange={(e) => router.push(`/?year=${e.target.value}`)}
      className="px-4 py-2 rounded-lg text-sm font-bold border-2 focus:outline-none focus:ring-2 focus:ring-green-500"
      style={{ backgroundColor: '#0C3D2E', borderColor: '#0C3D2E', color: 'white' }}
    >
      {years.map((y) => (
        <option key={y} value={y}>
          {y} 年{y === nowYear ? '（本年）' : ''}
        </option>
      ))}
    </select>
  );
}
