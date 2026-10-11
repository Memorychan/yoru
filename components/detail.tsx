'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import {
  Play,
  Plus,
  Check,
  Clock3,
  Globe2,
  ShieldCheck,
  ArrowLeft,
  Film,
  LockKeyhole,
} from 'lucide-react';
import { Shell } from './shell';
import { useData, Loading, ErrorBox } from './ui';
import { api, post, money, duration } from '@/lib/api';
import type { Title, Library } from '@/lib/types';
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, cb: (data: unknown) => void) => void;
    };
  }
}
async function checkoutScript() {
  if (window.Razorpay) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load checkout. Please try again.'));
    document.body.appendChild(script);
  });
}
function DetailContent({ id }: { id: string }) {
  const title = useData<Title>(`/catalog/${id}`);
  const library = useData<Library>('/library');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState(1);
  const [spoilers, setSpoilers] = useState(true);
  useEffect(() => setSpoilers(localStorage.getItem('yoru-spoilers') !== 'false'), []);
  if (title.loading) return <Loading />;
  if (title.error || !title.data)
    return <ErrorBox message={title.error || 'Title not found'} retry={title.reload} />;
  const t = title.data;
  const product = t.products[0];
  const saved = library.data?.saved.includes(id);
  const episodes = t.episodes.filter((e) => e.season === season);
  const first = t.episodes[0];
  async function save() {
    setError('');
    try {
      await post(`/saved/${id}`, { saved: !saved });
      library.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function buy() {
    setBusy(true);
    setError('');
    try {
      await checkoutScript();
      const order = await post<{
        id: string;
        providerOrderId: string;
        amount: number;
        currency: string;
        keyId: string;
        title: string;
      }>('/payments/orders', { productId: product.id });
      const checkout = new window.Razorpay!({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.providerOrderId,
        name: 'Yoru',
        description: order.title,
        theme: { color: '#f38a70' },
        handler: async (result: Record<string, string>) => {
          try {
            const response = await post<{ status: string }>('/payments/verify', {
              orderId: order.id,
              ...result,
            });
            setNotice(
              response.status === 'PAID'
                ? 'You’re all set. Enjoy the story.'
                : 'Payment is being confirmed. Refresh this page in a moment.',
            );
            title.reload();
            library.reload();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      checkout.on('payment.failed', () => {
        setError('Payment was not completed. You can try again.');
        setBusy(false);
      });
      checkout.open();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <section className="detail-hero">
        <img className="detail-backdrop" src={t.backdrop} alt="" />
        <div className="detail-vignette" />
        <div className="detail-content">
          <Link className="back-link" href="/browse">
            <ArrowLeft size={16} /> Back to browse
          </Link>
          <span className="eyebrow">
            {t.category} / {t.format === 'SERIES' ? 'SERIES' : 'FILM'}
          </span>
          <h1>{t.name}</h1>
          <div className="hero-meta">
            <span>{t.year}</span>
            <span className="rating">{t.ageRating}</span>
            <span>
              {t.format === 'SERIES'
                ? `${t.episodes.length} episodes`
                : duration(first?.duration || 0)}
            </span>
          </div>
          <div className="genre-list">
            {t.genres.map((g) => (
              <span key={g}>{g}</span>
            ))}
          </div>
          <p className="synopsis">{t.synopsis}</p>
          {error && <ErrorBox message={error} />}{' '}
          {notice && (
            <div className="success-box" role="status">
              {notice}
            </div>
          )}
          <div className="hero-actions">
            {t.showcase ? (
              <span className="button subdued">
                <Film size={18} /> Artwork preview
              </span>
            ) : t.canWatch && first ? (
              <Link className="button primary" href={`/watch/${first.id}`}>
                <Play size={18} fill="currentColor" />
                Start watching
              </Link>
            ) : product ? (
              <button className="button primary" disabled={busy} onClick={buy}>
                <LockKeyhole size={18} />
                {busy
                  ? 'Opening checkout…'
                  : `${product.mode === 'RENTAL' ? 'Rent' : 'Get access'} · ${money(product.pricePaise)}`}
              </button>
            ) : null}
            <button className="button glass" onClick={save}>
              {saved ? <Check size={20} /> : <Plus size={20} />}{' '}
              {saved ? 'In your watchlist' : 'Add to watchlist'}
            </button>
          </div>
          {t.showcase ? (
            <p className="purchase-note">
              Original sample artwork. Your admin can replace this entry with an uploaded title.
            </p>
          ) : product?.mode === 'RENTAL' ? (
            <p className="purchase-note">
              <Clock3 size={14} /> {product.rentalHours}-hour rental, starting when payment is
              confirmed. Includes all episodes currently in this title.
            </p>
          ) : product?.mode === 'PURCHASE' ? (
            <p className="purchase-note">
              One-time access to this title, including future episodes added to it, while it remains
              available in your circle.
            </p>
          ) : (
            <p className="purchase-note">Included for everyone in your circle.</p>
          )}
        </div>
      </section>
      <div className="detail-body">
        <section>
          <div className="section-heading">
            <h2>
              {t.format === 'SERIES' ? 'Episodes' : 'About this film'}
              <span className="accent-dot">.</span>
            </h2>
            {t.format === 'SERIES' && (
              <select
                aria-label="Season"
                value={season}
                onChange={(e) => setSeason(Number(e.target.value))}
              >
                {Array.from(new Set(t.episodes.map((e) => e.season))).map((s) => (
                  <option value={s} key={s}>
                    Season {s}
                  </option>
                ))}
              </select>
            )}
          </div>
          {t.format === 'SERIES' ? (
            <div className="episodes">
              {episodes.map((e) => (
                <Link
                  href={t.canWatch ? `/watch/${e.id}` : '#'}
                  onClick={(event) => {
                    if (!t.canWatch) event.preventDefault();
                  }}
                  className="episode-row"
                  key={e.id}
                >
                  <span className="episode-number">{String(e.number).padStart(2, '0')}</span>
                  <img src={t.backdrop} alt="" />
                  <div>
                    <h3>
                      {spoilers &&
                      !library.data?.progress.some((p) => p.episode.id === e.id && p.seconds > 5)
                        ? `Episode ${e.number}`
                        : e.name}
                    </h3>
                    <p>
                      Season {e.season} · Episode {e.number}
                    </p>
                  </div>
                  <span className="muted">{duration(e.duration)}</span>
                  {t.canWatch ? <Play size={19} /> : <LockKeyhole size={18} />}
                </Link>
              ))}
            </div>
          ) : (
            <p className="body-copy">{t.synopsis}</p>
          )}
        </section>
        <aside className="about-panel">
          <div>
            <Globe2 size={19} />
            <span>
              Languages<strong>{t.languages.join(', ') || 'Not specified'}</strong>
            </span>
          </div>
          <div>
            <ShieldCheck size={19} />
            <span>
              Age rating<strong>{t.ageRating}</strong>
            </span>
          </div>
          <div>
            <Film size={19} />
            <span>
              Format<strong>{t.format === 'SERIES' ? 'Series' : 'Feature film'}</strong>
            </span>
          </div>
        </aside>
      </div>
    </>
  );
}
export function Detail({ id }: { id: string }) {
  return (
    <Shell>
      <DetailContent id={id} />
    </Shell>
  );
}
