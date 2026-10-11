'use client';
import { useState } from 'react';
import {
  HardDrive,
  Plus,
  RefreshCw,
  KeyRound,
  Globe2,
  LockKeyhole,
  ExternalLink,
} from 'lucide-react';
import { useData, Loading, ErrorBox, Empty, Modal, Field } from './ui';
import { post } from '@/lib/api';
import type { Storage } from '@/lib/types';
interface Discovery {
  username: string;
  namespaces: string[];
  namespace: string;
  buckets: { id: string; private: boolean; size: number }[];
}
export function StorageManager() {
  const query = useData<Storage[]>('/admin/storage');
  const [add, setAdd] = useState(false);
  const [rotate, setRotate] = useState<Storage | null>(null);
  const [another, setAnother] = useState<Storage | null>(null);
  const [visibility, setVisibility] = useState<Storage | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  async function action(path: string, body: unknown = {}, success = 'Connection updated.') {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await post(path, body);
      query.reload();
      setNotice(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading admin-heading">
        <div>
          <span className="eyebrow">A HOME FOR EVERY STORY</span>
          <h1>
            Storage & buckets<span className="accent-dot">.</span>
          </h1>
          <p>Connect an account and create its buckets right here.</p>
        </div>
        <button className="button primary" onClick={() => setAdd(true)}>
          <Plus size={17} />
          Add HF account
        </button>
      </div>
      {(error || query.error) && <ErrorBox message={error || query.error} />}{' '}
      {notice && <div className="success-box">{notice}</div>}
      {query.loading ? (
        <Loading />
      ) : query.data?.length ? (
        <div className="storage-grid">
          {query.data.map((s) => (
            <section className="panel storage-card" key={s.id}>
              <div className="storage-icon">
                <HardDrive size={24} />
                <span className={`status ${s.health === 'CONNECTED' ? 'good' : ''}`}>
                  {s.health}
                </span>
              </div>
              <h2>{s.name}</h2>
              <p>{s.bucket}</p>
              <div className="storage-stats">
                <span>{s._count.assets} primary media assets</span>
                <span>{s.enabled ? 'Accepting uploads' : 'Uploads paused'}</span>
              </div>
              <div className="button-row">
                <button
                  className="button small glass"
                  disabled={busy}
                  onClick={() => action(`/admin/storage/${s.id}/check`, {}, 'Bucket is reachable.')}
                >
                  <RefreshCw size={14} />
                  Check
                </button>
                <button
                  className="button small glass"
                  disabled={busy}
                  onClick={() => action(`/admin/storage/${s.id}`, { enabled: !s.enabled })}
                >
                  {s.enabled ? 'Pause uploads' : 'Enable uploads'}
                </button>
                <button className="button small glass" onClick={() => setAnother(s)}>
                  <Plus size={14} />
                  New bucket
                </button>
                <button className="text-button" onClick={() => setRotate(s)}>
                  Rotate token
                </button>
                <button className="text-button" onClick={() => setVisibility(s)}>
                  Visibility
                </button>
                <a
                  className="text-button"
                  href={`https://huggingface.co/buckets/${s.bucket}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open on HF <ExternalLink size={12} />
                </a>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Empty title="Your first bucket starts here">
          Add an HF access token, then create a public or private bucket. No separate bucket setup
          is needed.
        </Empty>
      )}
      <p className="admin-footnote">
        Pausing uploads leaves existing playback available. Tokens need write permission to create
        buckets and read/write permission to upload and stream.
      </p>
      {add && (
        <ConnectStorage
          close={() => setAdd(false)}
          done={() => {
            setAdd(false);
            query.reload();
            setNotice('Storage is connected and ready for uploads.');
          }}
        />
      )}
      {(rotate || another || visibility) && (
        <Modal
          title={
            rotate
              ? 'Rotate access token'
              : another
                ? 'Create another bucket'
                : 'Change bucket visibility'
          }
          close={() => {
            setRotate(null);
            setAnother(null);
            setVisibility(null);
            setError('');
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError('');
              try {
                if (rotate) await post(`/admin/storage/${rotate.id}`, { token: f.get('token') });
                else if (another)
                  await post(`/admin/storage/${another.id}/buckets`, {
                    name: f.get('name'),
                    bucketName: f.get('bucketName'),
                    private: f.get('visibility') === 'private',
                  });
                else if (visibility)
                  await post(`/admin/storage/${visibility.id}/visibility`, {
                    private: f.get('visibility') === 'private',
                  });
                setRotate(null);
                setAnother(null);
                setVisibility(null);
                query.reload();
                setNotice('Storage updated.');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {error && <ErrorBox message={error} />}{' '}
            {rotate ? (
              <Field label="New access token">
                <input name="token" type="password" autoComplete="off" required minLength={10} />
              </Field>
            ) : (
              <>
                {another && (
                  <>
                    <p className="muted">
                      Creates a new bucket under {another.bucket.split('/')[0]} using the stored
                      token.
                    </p>
                    <Field label="Display name">
                      <input name="name" required maxLength={100} placeholder="More movie nights" />
                    </Field>
                    <Field label="Bucket name">
                      <input
                        name="bucketName"
                        required
                        pattern="[a-zA-Z0-9_-]{1,96}"
                        placeholder="movie-nights-02"
                      />
                    </Field>
                  </>
                )}
                <Field label="Visibility">
                  <select name="visibility" defaultValue="public">
                    <option value="public">Public — encrypted media only</option>
                    <option value="private">Private — token required to download</option>
                  </select>
                </Field>
                <p className="muted">
                  Video stays encrypted in either mode. Changing visibility does not publish titles
                  in Yoru.
                </p>
              </>
            )}
            <div className="modal-actions">
              <button className="button primary" disabled={busy}>
                {busy ? 'Saving…' : another ? 'Create bucket' : 'Save changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function ConnectStorage({ close, done }: { close: () => void; done: () => void }) {
  const [token, setToken] = useState('');
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [namespace, setNamespace] = useState('');
  const [mode, setMode] = useState('create');
  const [name, setName] = useState('');
  const [bucketName, setBucketName] = useState('');
  const [existing, setExisting] = useState('');
  const [privateBucket, setPrivateBucket] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function discover(owner?: string) {
    setBusy(true);
    setError('');
    try {
      const result = await post<Discovery>('/admin/storage/discover', {
        token,
        ...(owner ? { namespace: owner } : {}),
      });
      setDiscovery(result);
      setNamespace(result.namespace);
      setExisting(result.buckets[0]?.id || '');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Connect Hugging Face" close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!discovery) {
            await discover();
            return;
          }
          setBusy(true);
          setError('');
          try {
            await post('/admin/storage', {
              name,
              bucket: mode === 'create' ? `${namespace}/${bucketName}` : existing,
              token,
              createBucket: mode === 'create',
              private: privateBucket,
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
        <div className="setup-steps">
          <span className={!discovery ? 'active' : ''}>01 · Account</span>
          <span className={discovery ? 'active' : ''}>02 · Bucket</span>
          <span>03 · Ready</span>
        </div>
        <Field
          label="HF access token"
          hint="The token stays on the server after saving. Use a write-enabled token."
        >
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setDiscovery(null);
            }}
            required
            minLength={10}
            placeholder="hf_…"
          />
        </Field>
        <a
          className="text-button"
          href="https://huggingface.co/settings/tokens"
          target="_blank"
          rel="noreferrer"
        >
          Create a token on Hugging Face <ExternalLink size={12} />
        </a>
        {discovery && (
          <>
            <div className="success-box">
              <KeyRound size={17} />
              Connected as {discovery.username}
            </div>
            <Field label="Account / organization">
              <select
                value={namespace}
                disabled={busy}
                onChange={(e) => {
                  void discover(e.target.value);
                }}
              >
                {discovery.namespaces.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </Field>
            <div className="filter-tabs">
              <button
                type="button"
                className={mode === 'create' ? 'selected' : ''}
                onClick={() => setMode('create')}
              >
                Create a new bucket
              </button>
              <button
                type="button"
                className={mode === 'existing' ? 'selected' : ''}
                onClick={() => setMode('existing')}
              >
                Connect existing
              </button>
            </div>
            <Field label="Connection display name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Our anime collection"
                required
                maxLength={100}
              />
            </Field>
            {mode === 'create' ? (
              <>
                <Field
                  label="New bucket name"
                  hint={`Created under ${namespace}. Use letters, numbers, hyphens or underscores.`}
                >
                  <input
                    value={bucketName}
                    onChange={(e) => setBucketName(e.target.value)}
                    required
                    pattern="[a-zA-Z0-9_-]{1,96}"
                    placeholder="yoru-library"
                  />
                </Field>
                <Field label="Visibility">
                  <select
                    value={privateBucket ? 'private' : 'public'}
                    onChange={(e) => setPrivateBucket(e.target.value === 'private')}
                  >
                    <option value="public">Public — encrypted media only</option>
                    <option value="private">Private</option>
                  </select>
                </Field>
              </>
            ) : (
              <Field label="Existing bucket">
                <select value={existing} onChange={(e) => setExisting(e.target.value)} required>
                  <option value="">Select a bucket</option>
                  {discovery.buckets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.id} · {b.private ? 'Private' : 'Public'}
                    </option>
                  ))}
                </select>
                {!discovery.buckets.length && (
                  <small>No buckets yet. Choose Create a new bucket.</small>
                )}
              </Field>
            )}
          </>
        )}
        <div className="modal-actions">
          <button className="button primary" disabled={busy}>
            {busy
              ? 'Connecting…'
              : !discovery
                ? 'Find my account'
                : mode === 'create'
                  ? 'Create bucket & connect'
                  : 'Connect bucket'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
