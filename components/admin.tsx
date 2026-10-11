'use client';
import { useState, useRef, useEffect, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { VideoUpload } from './upload-start';
import { byteLabel } from './upload-detail';
import { useUploadTask } from '@/lib/upload-client';
import {
  LayoutDashboard,
  Film,
  HardDrive,
  Users,
  Rows3,
  Receipt,
  UploadCloud,
  Plus,
  ArrowUpRight,
  Check,
  X,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  ImagePlus,
  Pause,
  Play,
  Copy,
  ArrowLeft,
  Pencil,
  ShieldCheck,
  Activity,
} from 'lucide-react';
import { Shell, useUser } from './shell';
import { StorageManager } from './storage-admin';
import { StorageCopies } from './transfers';
import { DriveManager } from './drive-admin';
import { SystemMonitor } from './system-monitor';
import { ColabManager } from './colab-admin';
import { useData, Loading, ErrorBox, Empty, Modal, Field } from './ui';
import { api, post, money } from '@/lib/api';
import type { Title, Storage, Upload, Collection, Order, Episode } from '@/lib/types';
const sections = [
  ['overview', 'Overview', LayoutDashboard],
  ['content', 'Content library', Film],
  ['uploads', 'Upload queue', UploadCloud],
  ['history', 'Upload history', Rows3],
  ['monitor', 'System monitor', Activity],
  ['colab', 'Colab GPU', Activity],
  ['storage', 'Storage', HardDrive],
  ['drive', 'Google Drive', UploadCloud],
  ['collections', 'Carousels', Rows3],
  ['members', 'Your circle', Users],
  ['orders', 'Orders', Receipt],
] as const;
type Section = (typeof sections)[number][0];
function AdminContent() {
  const user = useUser();
  const [section, setSection] = useState<Section>('overview');
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('section');
    if (sections.some(([key]) => key === requested)) setSection(requested as Section);
  }, []);
  if (user?.role !== 'ADMIN')
    return (
      <Empty title="This space is for your admin">
        Return to <Link href="/">your library</Link>.
      </Empty>
    );
  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <span className="eyebrow">THE CONTROL ROOM</span>
        <h2>
          Admin studio<span className="accent-dot">.</span>
        </h2>
        <nav aria-label="Admin navigation">
          {sections.map(([key, label, Icon]) => (
            <button
              className={section === key ? 'active' : ''}
              key={key}
              onClick={() => setSection(key)}
            >
              <Icon size={19} />
              {label}
              {key === section && <span />}
            </button>
          ))}
        </nav>
        <div className="studio-note">
          <ShieldCheck size={23} />
          <strong>Your circle. Your rules.</strong>
          <p>Curate something worth sharing.</p>
        </div>
        <Link href="/" className="back-link">
          <ArrowLeft size={15} />
          Back to watching
        </Link>
      </aside>
      <div className="admin-content">
        {section === 'overview' ? (
          <Overview navigate={setSection} />
        ) : section === 'content' ? (
          <ContentManager />
        ) : section === 'uploads' ? (
          <UploadQueue />
        ) : section === 'history' ? (
          <UploadQueue history />
        ) : section === 'monitor' ? (
          <SystemMonitor />
        ) : section === 'colab' ? (
          <ColabManager />
        ) : section === 'storage' ? (
          <StorageManager />
        ) : section === 'drive' ? (
          <DriveManager />
        ) : section === 'collections' ? (
          <CollectionsManager />
        ) : section === 'members' ? (
          <Members />
        ) : (
          <Orders />
        )}
      </div>
    </div>
  );
}
export function Admin() {
  return (
    <Shell>
      <AdminContent />
    </Shell>
  );
}
function AdminHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading admin-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>
          {title}
          <span className="accent-dot">.</span>
        </h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
interface OverviewData {
  members: number;
  titles: number;
  revenue: number;
  purchases: number;
  uploads: Upload[];
  audits: { id: string; action: string; target: string; createdAt: string }[];
}
function Overview({ navigate }: { navigate: (s: Section) => void }) {
  const { data, error, loading, reload } = useData<OverviewData>('/admin/overview');
  return (
    <>
      <AdminHeading
        eyebrow="A LOOK AT YOUR UNIVERSE"
        title="Welcome to the studio"
        description="A little curation goes a long way."
      >
        <button className="button primary" onClick={() => navigate('content')}>
          <Plus size={17} />
          Add a story
        </button>
      </AdminHeading>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} retry={reload} />
      ) : (
        data && (
          <>
            <div className="stats-grid">
              {[
                [Film, 'In your library', data.titles],
                [Users, 'Circle members', data.members],
                [Receipt, 'Captured revenue', money(data.revenue)],
                [Check, 'Paid orders', data.purchases],
              ].map(([Icon, label, value], i) => {
                const I = Icon as typeof Film;
                return (
                  <div className="stat-card" key={i}>
                    <I size={20} />
                    <span>{String(label)}</span>
                    <strong>{String(value)}</strong>
                  </div>
                );
              })}
            </div>
            <div className="admin-feature">
              <div>
                <span className="eyebrow">MAKE TONIGHT A GOOD ONE</span>
                <h2>The next favorite starts with you.</h2>
                <p>Add a movie, build a series, or put together a collection for your friends.</p>
                <button className="button primary" onClick={() => navigate('content')}>
                  Open content library <ArrowUpRight size={17} />
                </button>
              </div>
              <img src="/art/orbit.png" alt="A fox astronaut exploring a small planet" />
            </div>
            <div className="admin-two-col">
              <section className="panel">
                <div className="section-heading">
                  <h2>Recent uploads</h2>
                  <button className="text-button" onClick={() => navigate('uploads')}>
                    View all
                  </button>
                </div>
                {data.uploads.length ? (
                  data.uploads.slice(0, 4).map((u) => <Job key={u.id} upload={u} />)
                ) : (
                  <Empty title="Ready when you are">Your uploads will appear here.</Empty>
                )}
              </section>
              <section className="panel">
                <h2>Studio activity</h2>
                {data.audits.length ? (
                  data.audits.slice(0, 6).map((a) => (
                    <div className="activity-row" key={a.id}>
                      <Activity size={15} />
                      <div>
                        <strong>{a.action.toLowerCase().replaceAll('_', ' ')}</strong>
                        <small>{new Date(a.createdAt).toLocaleString()}</small>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted">Your latest changes will appear here.</p>
                )}
              </section>
            </div>
          </>
        )
      )}
    </>
  );
}
function Job({ upload: u }: { upload: Upload }) {
  const task = useUploadTask(u.id);
  return (
    <div className="job">
      <div>
        <UploadCloud size={19} />
        <div>
          <strong>{u.episode?.title.name || u.filename}</strong>
          <small>{u.episode?.name || u.filename}</small>
        </div>
        <span
          className={`status ${u.state === 'READY' ? 'good' : u.state === 'FAILED' ? 'bad' : ''}`}
        >
          {u.state}
        </span>
      </div>
      <div className="progress-track">
        <span style={{ width: `${u.progress}%` }} />
      </div>
      <small>
        {u.progress}% {u.error && `· ${u.error}`}
        {task.running && ` · ${task.message} · ${byteLabel(task.speed)}/s`}
      </small>
    </div>
  );
}
function UploadQueue({ history = false }: { history?: boolean }) {
  const [date, setDate] = useState(''),
    [page, setPage] = useState(0);
  const params = new URLSearchParams({ page: String(page) });
  if (date) {
    const start = new Date(`${date}T00:00:00`),
      end = new Date(start);
    end.setDate(end.getDate() + 1);
    params.set('start', start.toISOString());
    params.set('end', end.toISOString());
  }
  const active = useData<Upload[]>(history ? null : '/admin/uploads');
  const archive = useData<{ rows: Upload[]; hasMore: boolean }>(
    history ? `/admin/upload-history?${params}` : null,
  );
  const { error, loading, reload } = history ? archive : active;
  const data = history ? archive.data?.rows : active.data;
  const groups = new Map<string, Upload[]>();
  for (const row of data || []) {
    const key = row.episode?.title.id || row.episode?.title.name || row.id;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const [message, setMessage] = useState('');
  useEffect(() => {
    const timer = setInterval(reload, 2000);
    return () => clearInterval(timer);
  }, [reload]);
  return (
    <>
      <AdminHeading
        eyebrow="FROM UPLOAD TO PLAY"
        title={history ? 'Upload history' : 'Active uploads'}
        description={
          history
            ? 'Filter by submission date in your device timezone.'
            : 'Completed episodes stay with their title until every submitted upload is ready or cancelled. Failed uploads stay visible for retry.'
        }
      >
        <button className="button glass" onClick={reload}>
          <RefreshCw size={17} />
          Refresh
        </button>
      </AdminHeading>
      {history && (
        <label>
          Submission date{' '}
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(0);
            }}
          />
          <button
            className="button small glass"
            onClick={() => {
              setDate('');
              setPage(0);
            }}
          >
            All dates
          </button>
        </label>
      )}
      {error && <ErrorBox message={error} />} {message && <ErrorBox message={message} />}{' '}
      {loading && !data ? (
        <Loading />
      ) : data?.length ? (
        <section className="panel">
          {[...groups].map(([key, rows]) => (
            <details className="upload-title-group" key={key}>
              <summary>
                <strong>{rows[0].episode?.title.name || 'Upload'}</strong> ·{' '}
                {rows.filter((row) => row.state === 'READY').length}/{rows.length} ready ·{' '}
                {rows.filter((row) => !['READY', 'CANCELLED', 'FAILED'].includes(row.state)).length}{' '}
                active {rows.some((row) => row.state === 'FAILED') ? ' · Needs attention' : ''}
              </summary>
              {rows.map((u) => (
                <div key={u.id}>
                  <Job upload={u} />
                  {u.state === 'COLAB_ENCODING' && (
                    <button
                      className="button small glass"
                      onClick={async () => {
                        try {
                          await post(`/admin/colab/release/${u.id}`, {});
                          reload();
                        } catch (e) {
                          setMessage((e as Error).message);
                        }
                      }}
                    >
                      Release Colab job
                    </button>
                  )}
                  <small>
                    Season {u.episode?.season || 1} · Episode {u.episode?.number || 1} · Submitted{' '}
                    {new Date(u.createdAt).toLocaleString()}
                  </small>
                  <p className="muted">
                    {u.stageDetail} · {byteLabel(Number(u.receivedBytes))} /{' '}
                    {byteLabel(Number(u.totalBytes))} saved{' '}
                    {u.heartbeatAt &&
                    Date.now() - new Date(u.heartbeatAt).getTime() < 15000 &&
                    u.speedBps > 0
                      ? ' · ' + byteLabel(u.speedBps) + '/s'
                      : ''}
                  </p>
                  <Link className="button small glass" href={`/admin/uploads/${u.id}`}>
                    View live details <ArrowUpRight size={15} />
                  </Link>
                  {['UPLOADING', 'FAILED', 'QUEUED'].includes(u.state) && (
                    <button
                      className="button small glass"
                      onClick={async () => {
                        try {
                          await post(`/admin/uploads/${u.id}/cancel`);
                          reload();
                        } catch (e) {
                          setMessage((e as Error).message);
                        }
                      }}
                    >
                      Cancel upload
                    </button>
                  )}
                  {u.state === 'FAILED' && (
                    <button
                      className="button small glass"
                      onClick={async () => {
                        try {
                          await post(`/admin/uploads/${u.id}/complete`);
                          reload();
                        } catch (e) {
                          setMessage((e as Error).message);
                        }
                      }}
                    >
                      Retry processing
                    </button>
                  )}
                </div>
              ))}
            </details>
          ))}
        </section>
      ) : (
        <Empty title="Nothing in the queue">
          Start an upload from a title in your content library.
        </Empty>
      )}
      {history && (
        <div className="section-heading">
          <button className="button glass" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>Page {page + 1}</span>
          <button
            className="button glass"
            disabled={!archive.data?.hasMore}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
const blank = {
  name: '',
  synopsis: '',
  format: 'MOVIE' as 'MOVIE' | 'SERIES',
  category: 'ANIME' as 'ANIME' | 'CARTOON' | 'LIVE_ACTION',
  genres: ['Adventure'],
  languages: ['Japanese'],
  year: new Date().getFullYear(),
  ageRating: '13+',
  poster: '/art/hero.png',
  backdrop: '/art/hero.png',
  featured: false,
  rightsNote: '',
  availableUntil: null as string | null,
};
function ContentManager() {
  const { data, error, loading, reload } = useData<Title[]>('/admin/titles');
  const [edit, setEdit] = useState<Title | null | undefined>(undefined);
  const [selected, setSelected] = useState<Title | null>(null);
  const [search, setSearch] = useState('');
  if (selected)
    return (
      <TitleManager
        id={selected.id}
        back={() => {
          setSelected(null);
          reload();
        }}
      />
    );
  return (
    <>
      <AdminHeading
        eyebrow="STORIES START HERE"
        title="Content library"
        description="Movies, series, and everyone’s next favorite."
      >
        <Link className="button primary" href="/admin/titles/new">
          <Plus size={17} />
          New title
        </Link>
      </AdminHeading>
      <input
        className="admin-search"
        aria-label="Search admin content"
        placeholder="Find a title…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {error && <ErrorBox message={error} retry={reload} />}{' '}
      {loading ? (
        <Loading />
      ) : data?.length ? (
        <div className="table-wrap panel">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Format</th>
                <th>Access</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data
                .filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
                .map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className="table-title">
                        <img src={t.poster} alt="" />
                        <div>
                          <strong>{t.name}</strong>
                          <small>
                            {t.category} · {t.year}
                            {t.showcase ? ' · Artwork sample' : ''}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>{t.format === 'SERIES' ? `${t.episodes.length} episodes` : 'Movie'}</td>
                    <td>
                      {t.products[0]?.mode === 'FREE'
                        ? 'Free'
                        : `${t.products[0]?.mode === 'RENTAL' ? 'Rent ' : ''}${money(t.products[0]?.pricePaise || 0)}`}
                    </td>
                    <td>
                      <span className={`status ${t.status === 'PUBLISHED' ? 'good' : ''}`}>
                        {t.status}
                      </span>
                    </td>
                    <td>
                      <button className="button small glass" onClick={() => setSelected(t)}>
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Make room for the first story">Add a title to get started.</Empty>
      )}
      {edit !== undefined && (
        <TitleForm
          title={edit}
          close={() => setEdit(undefined)}
          done={() => {
            setEdit(undefined);
            reload();
          }}
        />
      )}
    </>
  );
}
function ArtworkInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="field">
      <span>{label}</span>
      <div className="artwork-input">
        <img src={value} alt="Selected artwork" />
        <label className="button small glass">
          <ImagePlus size={15} />
          {busy ? 'Uploading…' : 'Upload image'}
          <input
            type="file"
            className="sr-only"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              setError('');
              try {
                const body = new FormData();
                body.append('file', file);
                const result = await api<{ url: string }>('/admin/artwork', {
                  method: 'POST',
                  body,
                });
                onChange(result.url);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      </div>
      <input
        aria-label={`${label} URL`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Or use an HTTPS image URL"
      />
      {error && <small className="danger">{error}</small>}
    </div>
  );
}
function TitleForm({
  title,
  close,
  done,
}: {
  title: Title | null;
  close: () => void;
  done: () => void;
}) {
  const [form, setForm] = useState(title ? { ...blank, ...title } : blank);
  const [genres, setGenres] = useState(form.genres.join(', '));
  const [languages, setLanguages] = useState(form.languages.join(', '));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const update = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }));
  return (
    <section className="panel title-edit-form">
      <h2>{title ? 'Edit title' : 'A new story'}</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await post(title ? `/admin/titles/${title.id}` : '/admin/titles', {
              ...form,
              genres: genres
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean),
              languages: languages
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean),
            });
            done();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <ErrorBox message={error} />}
        <div className="form-grid">
          <Field label="Title">
            <input
              required
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="Every story needs a name"
              maxLength={150}
            />
          </Field>
          <Field label="Release year">
            <input
              type="number"
              min={1900}
              max={2100}
              value={form.year}
              onChange={(e) => update('year', Number(e.target.value))}
            />
          </Field>
          <Field label="Format">
            <select
              value={form.format}
              disabled={title?.status === 'PUBLISHED' || busy}
              onChange={(e) => update('format', e.target.value)}
            >
              <option value="MOVIE">Movie</option>
              <option value="SERIES">Series</option>
            </select>
            {title && (
              <small className="muted">
                {title.status === 'PUBLISHED'
                  ? 'Unpublish to switch between Movie and Series.'
                  : 'Change a movie into a series, or a single-episode series into a movie. Uploaded video and progress are kept.'}
              </small>
            )}
          </Field>
          <Field label="Category">
            <select value={form.category} onChange={(e) => update('category', e.target.value)}>
              <option value="ANIME">Anime</option>
              <option value="CARTOON">Cartoon</option>
              <option value="LIVE_ACTION">Live action · movies & series</option>
            </select>
          </Field>
          <div className="span-2">
            <Field label="Synopsis">
              <textarea
                rows={3}
                required
                value={form.synopsis}
                onChange={(e) => update('synopsis', e.target.value)}
                maxLength={4000}
              />
            </Field>
          </div>
          <Field label="Genres" hint="Separate with commas">
            <input value={genres} onChange={(e) => setGenres(e.target.value)} />
          </Field>
          <Field label="Languages" hint="Separate with commas">
            <input value={languages} onChange={(e) => setLanguages(e.target.value)} />
          </Field>
          <Field label="Age rating">
            <select value={form.ageRating} onChange={(e) => update('ageRating', e.target.value)}>
              {['All ages', '7+', '13+', '16+', '18+'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Available until (optional)">
            <input
              type="date"
              value={form.availableUntil?.slice(0, 10) || ''}
              onChange={(e) =>
                update(
                  'availableUntil',
                  e.target.value ? new Date(`${e.target.value}T23:59:59Z`).toISOString() : null,
                )
              }
            />
          </Field>
          <ArtworkInput label="Poster" value={form.poster} onChange={(v) => update('poster', v)} />
          <ArtworkInput
            label="Backdrop"
            value={form.backdrop}
            onChange={(v) => update('backdrop', v)}
          />
          <div className="span-2">
            <Field label="Rights / source note">
              <input
                value={form.rightsNote}
                onChange={(e) => update('rightsNote', e.target.value)}
              />
            </Field>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.featured}
              onChange={(e) => update('featured', e.target.checked)}
            />
            Feature on the home page
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="button glass" onClick={close}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save title'}
          </button>
        </div>
      </form>
    </section>
  );
}
function TitleManager({ id, back }: { id: string; back: () => void }) {
  const query = useData<Title[]>('/admin/titles');
  const t = query.data?.find((t) => t.id === id);
  const [edit, setEdit] = useState(false);
  const [episodeForm, setEpisodeForm] = useState(false);
  const [driveImport, setDriveImport] = useState(false);
  const [editEpisode, setEditEpisode] = useState<Episode | null>(null);
  const [sequenceSeason, setSequenceSeason] = useState<number | null>(null);
  const [upload, setUpload] = useState<Episode | null>(null);
  const [subtitle, setSubtitle] = useState<Episode | null>(null);
  const [copies, setCopies] = useState<Episode | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('FREE');
  const [price, setPrice] = useState('0');
  const [hours, setHours] = useState('48');
  useEffect(() => {
    if (t?.products[0]) {
      setMode(t.products[0].mode);
      setPrice(String(t.products[0].pricePaise / 100));
      setHours(String(t.products[0].rentalHours));
    }
  }, [t]);
  if (query.loading && !t) return <Loading />;
  if (!t) return <ErrorBox message={query.error || 'Title not found'} />;
  return (
    <>
      <button className="back-link" onClick={back}>
        <ArrowLeft size={16} />
        Content library
      </button>
      <AdminHeading
        eyebrow={`${t.category} / ${t.format}`}
        title={t.name}
        description={
          t.status === 'PUBLISHED'
            ? 'Visible to your circle. Unpublish to replace media.'
            : 'A work in progress. Publish when all episodes are ready.'
        }
      >
        <Link className="button glass" href={`/admin/titles/${id}/edit`}>
          <Pencil size={16} />
          Edit details
        </Link>
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setError('');
            setBusy(true);
            try {
              await post(`/admin/titles/${id}/publish`, { published: t.status !== 'PUBLISHED' });
              query.reload();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t.status === 'PUBLISHED' ? 'Unpublish' : 'Publish title'}
        </button>
      </AdminHeading>
      {error && <ErrorBox message={error} />}{' '}
      {notice && <div className="success-box">{notice}</div>}
      <section className="panel">
        <h2>Access & pricing</h2>
        <p className="muted">Changes apply to new access. Earlier purchases keep their terms.</p>
        <form
          className="pricing-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await post(`/admin/titles/${id}/pricing`, {
                mode,
                pricePaise: Math.round(Number(price) * 100),
                rentalHours: Number(hours),
              });
              setNotice('Pricing saved.');
              query.reload();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Access">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="FREE">Free for the circle</option>
              <option value="PURCHASE">One-time purchase</option>
              <option value="RENTAL">Rental</option>
            </select>
          </Field>
          <Field label="Price (₹)">
            <input
              type="number"
              min={mode === 'FREE' ? 0 : 1}
              step="0.01"
              value={price}
              disabled={mode === 'FREE'}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <Field label="Rental duration (hours)">
            <input
              type="number"
              min={1}
              max={8760}
              value={hours}
              disabled={mode !== 'RENTAL'}
              onChange={(e) => setHours(e.target.value)}
            />
          </Field>
          <button className="button glass" disabled={busy}>
            Save pricing
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>{t.format === 'SERIES' ? 'Episodes' : 'Movie file'}</h2>
          {t.status === 'DRAFT' && (
            <button className="button small primary" onClick={() => setDriveImport(!driveImport)}>
              {driveImport ? 'Hide Drive import' : 'Import folder from Google Drive'}
            </button>
          )}
          {t.format === 'SERIES' && (
            <button
              className="button small glass"
              onClick={() => setEpisodeForm(true)}
              disabled={t.status === 'PUBLISHED'}
            >
              <Plus size={16} />
              Add episode
            </button>
          )}
        </div>
        {driveImport && t.status === 'DRAFT' && (
          <DriveManager initialTitleId={id} onApproved={query.reload} />
        )}
        {!t.episodes.length ? (
          <Empty title="Add your videos">
            Import a Google Drive folder to create seasons and episodes automatically, or add an
            episode manually.
          </Empty>
        ) : (
          [...new Set(t.episodes.map((e) => e.season))]
            .sort((a, b) => a - b)
            .map((season) => (
              <details
                className="upload-title-group"
                key={season}
                open={t.format === 'MOVIE' ? true : undefined}
              >
                <summary>
                  {t.format === 'MOVIE' ? 'Movie file' : `Season ${season}`} ·{' '}
                  {t.episodes.filter((e) => e.season === season).length} episodes
                </summary>
                {t.format === 'SERIES' && (
                  <button className="button small glass" onClick={() => setSequenceSeason(season)}>
                    Clean up episode names
                  </button>
                )}
                {t.episodes
                  .filter((e) => e.season === season)
                  .sort((a, b) => a.number - b.number)
                  .map((e) => (
                    <div className="admin-episode" key={e.id}>
                      <span className="episode-number">{String(e.number).padStart(2, '0')}</span>
                      <div>
                        <strong>{e.name}</strong>
                        <button className="text-button" onClick={() => setEditEpisode(e)}>
                          Edit episode
                        </button>
                        <small>
                          Season {e.season} ·{' '}
                          {e.asset ? 'Media ready' : e.uploads?.[0]?.state || 'No video uploaded'}
                        </small>
                      </div>
                      {e.asset && (
                        <>
                          <Link className="button small glass" href={`/watch/${e.id}?preview=1`}>
                            Preview
                          </Link>
                          <button className="button small glass" onClick={() => setCopies(e)}>
                            Storage copies
                          </button>
                          <button className="button small glass" onClick={() => setSubtitle(e)}>
                            Subtitles
                          </button>
                        </>
                      )}
                      <button
                        className="button small glass"
                        disabled={t.status === 'PUBLISHED'}
                        onClick={() => setUpload(e)}
                      >
                        <UploadCloud size={15} />
                        {e.asset ? 'Replace' : 'Upload'}
                      </button>
                    </div>
                  ))}
              </details>
            ))
        )}
      </section>
      {edit && (
        <TitleForm
          title={t}
          close={() => setEdit(false)}
          done={() => {
            setEdit(false);
            query.reload();
          }}
        />
      )}
      {sequenceSeason !== null && (
        <SequenceEditor
          titleId={id}
          season={sequenceSeason}
          episodes={t.episodes.filter((e) => e.season === sequenceSeason)}
          close={() => setSequenceSeason(null)}
          done={() => {
            setSequenceSeason(null);
            query.reload();
          }}
        />
      )}
      {editEpisode && (
        <EpisodeForm
          titleId={id}
          episode={editEpisode}
          close={() => setEditEpisode(null)}
          done={() => {
            setEditEpisode(null);
            query.reload();
          }}
        />
      )}
      {episodeForm && (
        <EpisodeForm
          titleId={id}
          close={() => setEpisodeForm(false)}
          done={() => {
            setEpisodeForm(false);
            query.reload();
          }}
        />
      )}
      {upload && (
        <VideoUpload
          episode={upload}
          close={() => setUpload(null)}
          done={() => {
            setUpload(null);
            query.reload();
          }}
        />
      )}
      {subtitle && <SubtitleForm episode={subtitle} close={() => setSubtitle(null)} />}
      {copies && (
        <StorageCopies
          episode={copies}
          close={() => {
            setCopies(null);
            query.reload();
          }}
        />
      )}
    </>
  );
}
function SequenceEditor({
  titleId,
  season,
  episodes,
  close,
  done,
}: {
  titleId: string;
  season: number;
  episodes: Episode[];
  close: () => void;
  done: () => void;
}) {
  const [rows, setRows] = useState(() =>
    [...episodes].sort((a, b) => a.number - b.number).map((e) => ({ id: e.id, name: e.name })),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal title={`Season ${season} · Episode names`} close={close}>
      <p className="muted">
        Remove changing episode markers from all names in this season. For example: Death Note -
        01x01 - Rebirth.mkv becomes Death Note - Rebirth.mkv. Preview and adjust before saving.
      </p>
      <div className="section-heading">
        <button
          type="button"
          className="button glass"
          disabled={busy}
          onClick={() =>
            setRows((current) =>
              current.map((row) => ({
                ...row,
                name: row.name
                  .replace(
                    /(?:^|\s*[-–—]\s*|\s+)(?:\d{1,3}x\d{1,4}|s\d{1,3}e\d{1,4})(?=\s*[-–—]|\s|\.|$)/gi,
                    '',
                  )
                  .replace(/^\s*[-–—]\s*/, '')
                  .replace(/\s{2,}/g, ' ')
                  .trim(),
              })),
            )
          }
        >
          Preview removal of episode markers
        </button>
        <button
          type="button"
          className="button small glass"
          disabled={busy}
          onClick={() =>
            setRows(
              [...episodes]
                .sort((a, b) => a.number - b.number)
                .map((e) => ({ id: e.id, name: e.name })),
            )
          }
        >
          Reset preview
        </button>
      </div>
      <p className="muted">
        Saving updates names only. Uploaded videos, episode numbers and viewing progress are
        preserved.
      </p>
      {error && <ErrorBox message={error} />}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await post(`/admin/titles/${titleId}/sequence`, { season, episodes: rows });
            done();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {rows.map((row, index) => (
          <div className="admin-episode" key={row.id}>
            <span className="episode-number">{index + 1}</span>
            <input
              aria-label={`Episode ${index + 1} name`}
              required
              maxLength={200}
              value={row.name}
              disabled={busy}
              onChange={(e) =>
                setRows((current) =>
                  current.map((item) =>
                    item.id === row.id ? { ...item, name: e.target.value } : item,
                  ),
                )
              }
            />
          </div>
        ))}
        <button className="button primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save episode names'}
        </button>
      </form>
    </Modal>
  );
}
function EpisodeForm({
  titleId,
  episode,
  close,
  done,
}: {
  titleId: string;
  episode?: Episode;
  close: () => void;
  done: () => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={episode ? 'Edit episode' : 'Add an episode'} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const form = new FormData(e.currentTarget);
          try {
            await post(
              episode ? `/admin/episodes/${episode.id}` : `/admin/titles/${titleId}/episodes`,
              {
                name: form.get('name'),
                season: Number(form.get('season')),
                number: Number(form.get('number')),
                introStart: Number(form.get('introStart')),
                introEnd: Number(form.get('introEnd')),
                outroStart: Number(form.get('outroStart')),
                outroEnd: Number(form.get('outroEnd')),
              },
            );
            done();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <ErrorBox message={error} />}
        <div className="form-grid">
          <div className="span-2">
            <Field label="Episode title">
              <input name="name" required maxLength={200} defaultValue={episode?.name} />
            </Field>
          </div>
          <Field label="Season">
            <input
              name="season"
              type="number"
              min={1}
              defaultValue={episode?.season || 1}
              required
            />
          </Field>
          <Field label="Episode number">
            <input
              name="number"
              type="number"
              min={1}
              defaultValue={episode?.number || 1}
              required
            />
          </Field>
          <Field label="Intro starts (seconds)">
            <input
              name="introStart"
              type="number"
              step="any"
              min={0}
              defaultValue={episode?.introStart || 0}
            />
          </Field>
          <Field label="Intro ends (seconds)">
            <input
              name="introEnd"
              type="number"
              step="any"
              min={0}
              defaultValue={episode?.introEnd || 0}
            />
          </Field>
          <Field label="Outro starts (seconds)">
            <input
              name="outroStart"
              type="number"
              min={0}
              step="any"
              defaultValue={episode?.outroStart || 0}
            />
          </Field>
          <Field label="Outro ends (seconds)">
            <input
              name="outroEnd"
              type="number"
              min={0}
              step="any"
              defaultValue={episode?.outroEnd || 0}
            />
          </Field>
        </div>
        <div className="modal-actions">
          <button className="button primary" disabled={busy}>
            {episode ? 'Save episode' : 'Add episode'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function SubtitleForm({ episode, close }: { episode: Episode; close: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Add subtitles" close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const form = new FormData(e.currentTarget);
            const file = form.get('file') as File;
            await post(`/admin/subtitles/${episode.id}`, {
              language: form.get('language'),
              text: await file.text(),
            });
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <ErrorBox message={error} />}
        <Field label="Language label">
          <input name="language" placeholder="English" pattern="[a-zA-Z0-9 -]{2,30}" required />
        </Field>
        <Field label="WebVTT file">
          <input type="file" name="file" accept=".vtt" required />
        </Field>
        <p className="muted">Subtitles are encrypted before upload, just like the video.</p>
        <button className="button primary" disabled={busy}>
          {busy ? 'Uploading…' : 'Add subtitles'}
        </button>
      </form>
    </Modal>
  );
}
function CollectionsManager() {
  const query = useData<Collection[]>('/admin/collections');
  const titles = useData<Title[]>('/admin/titles');
  const [edit, setEdit] = useState<Collection | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  return (
    <>
      <AdminHeading
        eyebrow="THE ART OF A GOOD LINEUP"
        title="Home carousels"
        description="Enabled carousels supply the home banner in their saved order and also appear as shelves. Only published titles are visible."
      >
        <button className="button primary" onClick={() => setEdit(null)}>
          <Plus size={17} />
          New carousel
        </button>
      </AdminHeading>
      {query.error && <ErrorBox message={query.error} />} {error && <ErrorBox message={error} />}
      {query.loading ? (
        <Loading />
      ) : query.data?.length ? (
        <div>
          {query.data.map((c) => (
            <section className="panel collection-admin" key={c.id}>
              <div>
                <span className="eyebrow">
                  SHELF {c.position + 1} · {c.enabled ? 'VISIBLE' : 'HIDDEN'}
                </span>
                <h2>{c.name}</h2>
                <p className="muted">{c.items.length} titles</p>
              </div>
              <div className="collection-thumbs">
                {c.items.slice(0, 4).map((i) => (
                  <img
                    key={i.titleId}
                    src={titles.data?.find((t) => t.id === i.titleId)?.poster || '/art/hero.png'}
                    alt=""
                  />
                ))}
              </div>
              <button className="button small glass" onClick={() => setEdit(c)}>
                Edit collection
              </button>
              <button
                className="button small glass"
                disabled={deleting !== null}
                onClick={async () => {
                  if (!window.confirm(`Delete ${c.name}? Its movies and episodes will remain.`))
                    return;
                  setDeleting(c.id);
                  setError('');
                  try {
                    await post(`/admin/collections/${c.id}/delete`, {});
                    query.reload();
                  } catch (error) {
                    setError((error as Error).message);
                  } finally {
                    setDeleting(null);
                  }
                }}
              >
                {deleting === c.id ? 'Deleting…' : 'Delete collection'}
              </button>
            </section>
          ))}
        </div>
      ) : (
        <Empty title="A good lineup makes the night">
          Create a carousel and arrange its titles.
        </Empty>
      )}
      {edit !== undefined && (
        <CollectionForm
          collection={edit}
          titles={titles.data || []}
          close={() => setEdit(undefined)}
          done={() => {
            setEdit(undefined);
            query.reload();
          }}
        />
      )}
    </>
  );
}
function CollectionForm({
  collection,
  titles,
  close,
  done,
}: {
  collection: Collection | null;
  titles: Title[];
  close: () => void;
  done: () => void;
}) {
  const [name, setName] = useState(collection?.name || '');
  const [position, setPosition] = useState(collection?.position || 0);
  const [enabled, setEnabled] = useState(collection?.enabled ?? true);
  const [ids, setIds] = useState(collection?.items.map((i) => i.titleId) || []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function move(i: number, d: number) {
    setIds((old) => {
      const next = [...old];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });
  }
  return (
    <Modal title={collection ? 'Edit carousel' : 'Create carousel'} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post('/admin/collections', {
              id: collection?.id,
              name,
              position,
              enabled,
              titleIds: ids,
            });
            done();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <ErrorBox message={error} />}
        <div className="form-grid">
          <Field label="Carousel name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </Field>
          <Field label="Position (0 = first)">
            <input
              type="number"
              min={0}
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
            />
          </Field>
        </div>
        <Field label="Add a title">
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) setIds([...ids, e.target.value]);
            }}
          >
            <option value="">Choose a title</option>
            {titles
              .filter((t) => !ids.includes(t.id))
              .map((t) => (
                <option value={t.id} key={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </Field>
        <div className="collection-order">
          {ids.map((id, i) => (
            <div
              key={id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const from = Number(e.dataTransfer.getData('text/plain'));
                if (!Number.isInteger(from) || from < 0 || from >= ids.length) return;
                const next = [...ids];
                const [item] = next.splice(from, 1);
                next.splice(i, 0, item);
                setIds(next);
              }}
            >
              <span>{i + 1}</span>
              <strong>{titles.find((t) => t.id === id)?.name}</strong>
              <button
                type="button"
                className="icon-button"
                disabled={!i}
                aria-label="Move up"
                onClick={() => move(i, -1)}
              >
                <ChevronUp size={17} />
              </button>
              <button
                type="button"
                className="icon-button"
                disabled={i === ids.length - 1}
                aria-label="Move down"
                onClick={() => move(i, 1)}
              >
                <ChevronDown size={17} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Remove title"
                onClick={() => setIds(ids.filter((x) => x !== id))}
              >
                <X size={17} />
              </button>
            </div>
          ))}
        </div>
        <label className="checkbox-label">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Visible on the home page
        </label>
        <div className="modal-actions">
          <button className="button primary" disabled={busy}>
            Save carousel
          </button>
        </div>
      </form>
    </Modal>
  );
}
interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  disabled: boolean;
}
function Members() {
  const query = useData<Member[]>('/admin/members');
  const [email, setEmail] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <AdminHeading
        eyebrow="BETTER WITH YOUR PEOPLE"
        title="Your circle"
        description="Make room for a friend. Invitations expire after seven days."
      />
      <section className="panel">
        <h2>Save someone a seat</h2>
        <form
          className="invite-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const result = await post<{ url: string }>('/admin/invites', email ? { email } : {});
              setUrl(result.url);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            type="email"
            aria-label="Invitation email"
            placeholder="Friend’s email (optional)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="button primary" disabled={busy}>
            <Plus size={17} />
            Create invitation
          </button>
        </form>
        {url && (
          <div className="invite-result">
            <input aria-label="Invitation link" readOnly value={url} />
            <button
              className="button glass"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                } catch {
                  setError('Copy the invitation from the text field.');
                }
              }}
            >
              <Copy size={16} />
              Copy
            </button>
          </div>
        )}
        <p className="muted">Share the link yourself. No email is sent automatically.</p>
      </section>
      {(error || query.error) && <ErrorBox message={error || query.error} />}
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {query.data?.map((m) => (
              <tr key={m.id}>
                <td>
                  <strong>{m.name}</strong>
                  <small>{m.email}</small>
                </td>
                <td>{m.role}</td>
                <td>
                  <span className={`status ${m.disabled ? '' : 'good'}`}>
                    {m.disabled ? 'DISABLED' : 'ACTIVE'}
                  </span>
                </td>
                <td>
                  {m.role !== 'ADMIN' && (
                    <button
                      className="button small glass"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await post(`/admin/members/${m.id}`, { disabled: !m.disabled });
                          query.reload();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {m.disabled ? 'Enable' : 'Disable'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
function Orders() {
  const query = useData<Order[]>('/admin/orders');
  const [refund, setRefund] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <AdminHeading
        eyebrow="KEEPING THINGS SIMPLE"
        title="Orders & payments"
        description="Purchases, rentals, and refunds for your circle."
      />
      {(error || query.error) && <ErrorBox message={error || query.error} />}{' '}
      {query.loading ? (
        <Loading />
      ) : query.data?.length ? (
        <section className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title / member</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {query.data.map((o) => (
                <tr key={o.id}>
                  <td>
                    <strong>{o.product.title.name}</strong>
                    <small>
                      {o.user?.name} · {o.mode}
                    </small>
                  </td>
                  <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                  <td>{money(o.amount)}</td>
                  <td>
                    <span className={`status ${o.status === 'PAID' ? 'good' : ''}`}>
                      {o.status}
                    </span>
                  </td>
                  <td>
                    {o.status === 'PAID' && (
                      <button className="text-button" onClick={() => setRefund(o)}>
                        Refund
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <Empty title="No orders yet">Free titles don’t create payment orders.</Empty>
      )}
      {refund && (
        <Modal title="Refund this order?" close={() => setRefund(null)}>
          <p>
            Return {money(refund.amount)} for {refund.product.title.name} to {refund.user?.name}.
            Access from this order is revoked when the refund is confirmed.
          </p>
          {error && <ErrorBox message={error} />}
          <div className="modal-actions">
            <button className="button glass" onClick={() => setRefund(null)}>
              Keep order
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await post(`/payments/refund/${refund.id}`);
                  setRefund(null);
                  query.reload();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Requesting…' : 'Confirm refund'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function TitleEditorContent({ id }: { id?: string }) {
  const user = useUser();
  const router = useRouter();
  const query = useData<Title[]>(id ? '/admin/titles' : null);
  const back = () => router.push('/admin?section=content');
  if (user?.role !== 'ADMIN') return <Empty title="Admin access required" />;
  if (id && query.loading) return <Loading />;
  const title = id ? query.data?.find((item) => item.id === id) : null;
  if (id && !title)
    return <ErrorBox message={query.error || 'Title not found'} retry={query.reload} />;
  return (
    <div className="page title-editor-page">
      <Link className="back-link" href="/admin?section=content">
        <ArrowLeft size={16} /> Content library
      </Link>
      <AdminHeading
        eyebrow="YOUR STORY, EVERY DETAIL"
        title={id ? 'Edit your title' : 'Create a title'}
        description="Artwork, category, format and every detail in one place."
      />
      <TitleForm key={id || 'new'} title={title || null} close={back} done={back} />
    </div>
  );
}
export function TitleEditor({ id }: { id?: string }) {
  return (
    <Shell>
      <TitleEditorContent id={id} />
    </Shell>
  );
}
