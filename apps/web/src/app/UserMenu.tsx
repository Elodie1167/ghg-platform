'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';

/** 首頁右上角的使用者選單：顯示目前登入者，可更換密碼或登出換人。 */
export default function UserMenu() {
  const { data: session } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  if (!session?.user) return null;

  const label = session.user.name ?? session.user.email ?? '使用者';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-4 py-2 rounded-lg text-sm font-medium text-white border border-white/30 hover:bg-white/10 transition flex items-center gap-2"
      >
        {label}
        <span style={{ fontSize: '0.7rem' }}>▾</span>
      </button>

      {open && (
        <div
          className="text-gray-800"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 0.5rem)',
            background: '#fff',
            borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            minWidth: '200px',
            overflow: 'hidden',
            zIndex: 50,
          }}
        >
          <div className="px-4 py-3 text-xs text-gray-500 border-b border-gray-100 truncate">
            {session.user.email}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              router.push('/change-password');
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition"
          >
            更換密碼
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              signOut({ callbackUrl: '/login' });
            }}
            className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition"
          >
            登出 / 換人登入
          </button>
        </div>
      )}
    </div>
  );
}
