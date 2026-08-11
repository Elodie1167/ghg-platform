'use client';

import { useState, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

/**
 * 更改自己的密碼。
 *
 * 兩種進入情境：
 *   1. 被強制導過來（must_change_password = true）——管理者代設過密碼，
 *      改完才能進主畫面。此時不顯示「取消」，避免使用者以為可以跳過。
 *   2. 自己主動來改——顯示「取消」可回上一頁。
 */

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem',
  marginBottom: '1rem',
  border: '1px solid #ccc',
  borderRadius: '4px',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '0.25rem',
  fontSize: '0.9rem',
};

export default function ChangePasswordPage() {
  const router = useRouter();
  const { data: session, update } = useSession();

  const forced =
    (session?.user as { mustChangePassword?: boolean } | undefined)?.mustChangePassword === true;

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (next !== confirm) {
      setError('兩次輸入的新密碼不一致');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? '更改失敗，請稍後再試');
        return;
      }

      // 讓 JWT 重讀 must_change_password，否則會被導回這一頁
      await update();
      router.replace('/');
    } catch {
      setError('連線失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f5f5f5',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          background: '#fff',
          padding: '2rem',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          width: '400px',
        }}
      >
        <h1 style={{ marginBottom: '0.25rem', fontSize: '1.25rem' }}>更改密碼</h1>

        {forced ? (
          <div
            style={{
              background: '#fff8e1',
              border: '1px solid #ffe082',
              borderRadius: '4px',
              padding: '0.75rem',
              margin: '1rem 0 1.5rem',
              fontSize: '0.875rem',
              lineHeight: 1.6,
              color: '#5d4037',
            }}
          >
            您目前的密碼是由管理者代為設定的，等於有第三人知道。
            <strong>請先改成只有您自己知道的密碼</strong>，才能開始使用平台。
          </div>
        ) : (
          <p style={{ color: '#666', margin: '0.25rem 0 1.5rem', fontSize: '0.9rem' }}>
            {session?.user?.email ?? ''}
          </p>
        )}

        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>目前密碼</label>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
            autoComplete="current-password"
            style={inputStyle}
          />

          <label style={labelStyle}>新密碼</label>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
            autoComplete="new-password"
            style={inputStyle}
          />

          <label style={labelStyle}>再次輸入新密碼</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
            style={inputStyle}
          />

          {error && (
            <p style={{ color: '#c00', fontSize: '0.875rem', marginBottom: '1rem' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '0.625rem',
              background: loading ? '#999' : '#1a5f3c',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
            }}
          >
            {loading ? '更改中...' : '確認更改'}
          </button>

          {!forced && (
            <button
              type="button"
              onClick={() => router.back()}
              style={{
                width: '100%',
                padding: '0.5rem',
                marginTop: '0.75rem',
                background: 'transparent',
                color: '#666',
                border: '1px solid #ccc',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              取消
            </button>
          )}
        </form>

        <p style={{ color: '#888', fontSize: '0.8rem', marginTop: '1.25rem', lineHeight: 1.6 }}>
          密碼長度與複雜度不限。請勿將密碼寫進檔案、Teams 或 Email。
        </p>
      </div>
    </main>
  );
}
