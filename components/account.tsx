'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, KeyRound } from 'lucide-react';
import { Shell, useUser } from './shell';
import { useData, Field, ErrorBox, Empty } from './ui';
import { MfaSettings } from './mfa';
import { Preferences } from './preferences';
import { post, money } from '@/lib/api';
import type { Library } from '@/lib/types';
function Content() {
  const user = useUser();
  const router = useRouter();
  const library = useData<Library>('/library');
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="page narrow">
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE YOURSELF AT HOME</span>
          <h1>
            Your account<span className="accent-dot">.</span>
          </h1>
        </div>
        <button
          className="button glass"
          onClick={async () => {
            try {
              await post('/auth/logout');
              router.push('/login');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <LogOut size={17} />
          Sign out
        </button>
      </div>
      <section className="panel profile-panel">
        <div className="avatar large">{user?.name[0]}</div>
        <div>
          <h2>{user?.name}</h2>
          <p>{user?.email}</p>
        </div>
        <span className="outline-pill">
          {user?.role === 'ADMIN' ? 'Circle admin' : 'Circle member'}
        </span>
      </section>
      <Preferences />
      <MfaSettings />
      <section className="panel">
        <h2>Change password</h2>
        <p className="muted">Updating your password signs you out on all devices.</p>
        {error && <ErrorBox message={error} />}
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await post('/auth/password', { current, password });
              router.push('/login');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Current password">
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </Field>
          <Field label="New password">
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <div>
            <button className="button primary" disabled={busy}>
              <KeyRound size={17} />
              Update password
            </button>
          </div>
        </form>
      </section>
      <section className="panel">
        <h2>Purchase history</h2>
        {library.error && <ErrorBox message={library.error} />}{' '}
        {library.data?.orders.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {library.data.orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      {o.product.title.name}
                      <small>{o.mode}</small>
                    </td>
                    <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                    <td>{money(o.amount)}</td>
                    <td>
                      <span className="status">{o.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No purchases yet">Your purchases and rentals will appear here.</Empty>
        )}
      </section>
    </div>
  );
}
export function Account() {
  return (
    <Shell>
      <Content />
    </Shell>
  );
}
