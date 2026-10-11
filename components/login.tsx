'use client';
import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Moon, ArrowUpRight, LockKeyhole, Eye, EyeOff } from 'lucide-react';
import { post } from '@/lib/api';
import { Field, ErrorBox } from './ui';
export function Login() {
  const params = useSearchParams();
  const invite = params.get('invite');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main className="login-page">
      <section className="login-art">
        <img src="/art/hero.png" alt="An original anime illustration of a city at dusk" />
        <div className="login-art-shade" />
        <Link href="/preview" className="brand">
          {' '}
          <img src="/yoru-logo.png" width={36} height={36} alt="" /> yoru
          <span className="brand-dot">.</span>
        </Link>
        <div className="login-art-copy">
          <span className="eyebrow">A SHARED UNIVERSE</span>
          <h1>
            Good stories.
            <br />
            Better company.
          </h1>
          <p>
            Your favorite worlds, and your favorite people.
            <br />
            All in one little corner of the internet.
          </p>
        </div>
        <span className="login-credit">BEYOND THE BLUE · ORIGINAL YORU ARTWORK</span>
      </section>
      <section className="login-form-side">
        <div className="login-top">
          <LockKeyhole size={16} /> INVITE ONLY
        </div>
        <form
          className="login-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await post(invite ? '/auth/join' : '/auth/login', {
                email,
                password,
                code,
                ...(invite ? { name, invite } : {}),
              });
              router.push('/');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="eyebrow">YOUR EVENING STARTS HERE</span>
          <h2>{invite ? 'Welcome to the circle.' : 'Welcome back.'}</h2>
          <p>
            {invite
              ? 'A friend saved you a seat. Make yourself at home.'
              : 'A whole universe is waiting for you.'}
          </p>
          {error && <ErrorBox message={error} />}{' '}
          {invite && (
            <Field label="Your name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={60}
                autoComplete="name"
                placeholder="What should we call you?"
              />
            </Field>
          )}
          <Field label="Email address">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </Field>
          <Field
            label="Password"
            hint={invite ? 'At least 12 characters. Make it something only you know.' : undefined}
          >
            <div className="password-field">
              <input
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
                maxLength={128}
                autoComplete={invite ? 'new-password' : 'current-password'}
                placeholder="Your password"
              />
              <button
                type="button"
                aria-label={show ? 'Hide password' : 'Show password'}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>
          {!invite && (
            <Field label="Authenticator code (if enabled)">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                placeholder="Six-digit code or recovery code"
                maxLength={32}
              />
            </Field>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? 'One moment…' : invite ? 'Join the circle' : 'Let me in'}
            <ArrowUpRight size={18} />
          </button>
          <p className="login-help">
            {invite
              ? 'Your invitation can be used once and expires after 7 days.'
              : 'Need an invitation or a password reset? Ask your circle’s admin.'}
          </p>
          <Link className="text-button" href="/preview">
            Take a look around first
          </Link>
        </form>
        <p className="login-bottom">Just you, your friends, and something great to watch.</p>
      </section>
    </main>
  );
}
