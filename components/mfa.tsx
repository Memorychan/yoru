'use client';
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useData, Field, ErrorBox } from './ui';
import { post } from '@/lib/api';
export function MfaSettings() {
  const query = useData<{ enabled: boolean; recoveryRemaining: number }>('/auth/mfa');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel">
      <h2>Two-factor authentication</h2>
      <p className="muted">
        {query.data?.enabled
          ? `Enabled · ${query.data.recoveryRemaining} recovery codes remaining`
          : 'Add an authenticator app to protect your account.'}
      </p>
      {(error || query.error) && <ErrorBox message={error || query.error} />}{' '}
      {codes.length > 0 && (
        <div className="success-box">
          <strong>Save these recovery codes somewhere private.</strong>
          <p>Each code works once. They will not be shown again.</p>
          <pre>{codes.join('\n')}</pre>
          <button className="text-button" onClick={() => setCodes([])}>
            I’ve saved them
          </button>
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          setBusy(true);
          try {
            if (query.data?.enabled) {
              await post('/auth/mfa/disable', { password, code });
              query.reload();
            } else if (secret) {
              const result = await post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code });
              setCodes(result.recoveryCodes);
              setSecret('');
              query.reload();
            } else {
              const result = await post<{ secret: string }>('/auth/mfa/setup', { password });
              setSecret(result.secret);
            }
            setCode('');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Current password">
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {(secret || query.data?.enabled) && (
            <Field label="Authenticator / recovery code">
              <input
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                maxLength={32}
              />
            </Field>
          )}
        </div>
        {secret && (
          <div className="success-box" style={{ display: 'block' }}>
            <strong>Add a time-based account in your authenticator app.</strong>
            <p>Account: Yoru. Paste this setup key, then enter the six-digit code.</p>
            <code style={{ overflowWrap: 'anywhere' }}>{secret}</code>
          </div>
        )}
        <button className="button glass" disabled={busy || query.loading}>
          <ShieldCheck size={17} />
          {busy
            ? 'Saving…'
            : query.data?.enabled
              ? 'Disable two-factor authentication'
              : secret
                ? 'Verify and enable'
                : 'Set up authenticator'}
        </button>
      </form>
    </section>
  );
}
