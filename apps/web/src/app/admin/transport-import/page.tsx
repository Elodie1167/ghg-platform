import { query } from '@/lib/db';
import TransportImportClient from './TransportImportClient';

export const dynamic = 'force-dynamic';

export default async function TransportImportPage() {
  const factoriesRes = await query(
    `SELECT id, factory_code, name_zh FROM factories WHERE is_active = TRUE ORDER BY factory_code`,
  );
  return <TransportImportClient factories={factoriesRes.rows} />;
}
