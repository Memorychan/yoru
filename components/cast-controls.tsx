'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Cast, Pause, Play, RotateCcw, RotateCw, X } from 'lucide-react';
import { post } from '@/lib/api';

// The sender SDK is supplied by Google at runtime, not bundled with the app.
type CastWindow = Window & {
  cast?: any;
  chrome?: any;
  __onGCastApiAvailable?: (available: boolean) => void;
};
let sdk: Promise<void> | undefined;
let initialized = false;
function loadSdk() {
  if (sdk) return sdk;
  sdk = new Promise<void>((resolve, reject) => {
    const w = window as CastWindow;
    if (w.cast?.framework) return resolve();
    w.__onGCastApiAvailable = (available) =>
      available
        ? resolve()
        : reject(
            new Error(
              'Google Cast is unavailable in this browser. Use Chrome with a Cast-enabled TV.',
            ),
          );
    const script = document.createElement('script');
    script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    script.onerror = () =>
      reject(new Error('Could not load Google Cast. Check your connection or browser extensions.'));
    document.head.appendChild(script);
    setTimeout(() => {
      if (!w.cast?.framework) {
        sdk = undefined;
        reject(new Error('Google Cast is unavailable. Use Chrome and allow local network access.'));
      }
    }, 15000);
  });
  return sdk;
}
function initializeCast() {
  const w = window as CastWindow;
  const ctx = w.cast.framework.CastContext.getInstance();
  if (!initialized) {
    ctx.setOptions({
      receiverApplicationId: w.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: w.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      resumeSavedSession: true,
    });
    initialized = true;
  }
  return ctx;
}
export function CastControls({
  video,
  url,
  title,
  episodeId,
  audio,
}: {
  video: RefObject<HTMLVideoElement | null>;
  url: string;
  title: string;
  episodeId: string;
  audio: number;
}) {
  const [available, setAvailable] = useState(false),
    [active, setActive] = useState(false),
    [busy, setBusy] = useState(false);
  const [discovery, setDiscovery] = useState('INITIALIZING');
  const [error, setError] = useState(''),
    [name, setName] = useState('TV'),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [paused, setPaused] = useState(false),
    [volume, setVolume] = useState(1);
  const capability = useRef<{ ticket: string; session: string } | null>(null);
  const remoteTime = useRef(0),
    wasActive = useRef(false),
    wasPlaying = useRef(false);
  const lastSaved = useRef(0);
  const context = () => (window as CastWindow).cast?.framework.CastContext.getInstance();
  const media = () => context()?.getCurrentSession()?.getMediaSession();
  async function release() {
    const access = capability.current;
    capability.current = null;
    if (access)
      await post(`/playback/session/${access.session}/cast/stop`, { ticket: access.ticket }).catch(
        () => {},
      );
  }
  useEffect(() => {
    let alive = true;
    let ctx: any;
    let stateEvent: string;
    const updateDiscovery = () => {
      if (alive && ctx) setDiscovery(ctx.getCastState());
    };
    const sync = () => {
      if (!alive) return;
      const session = context()?.getCurrentSession();
      const m = session?.getMediaSession();
      const owned = m?.media?.customData?.yoruEpisode === episodeId;
      const playing = owned && m.playerState !== 'IDLE';
      setActive(!!playing);
      if (playing) {
        video.current?.pause();
        remoteTime.current = m.getEstimatedTime();
        setTime(remoteTime.current);
        setDuration(m.media.duration || 0);
        setPaused(m.playerState === 'PAUSED');
        setName(session.getCastDevice().friendlyName);
        setVolume(session.getVolume() ?? 1);
        if (Date.now() - lastSaved.current > 15000) {
          lastSaved.current = Date.now();
          void post(`/progress/${episodeId}`, { seconds: remoteTime.current }).catch(() => {});
        }
      } else if (wasActive.current) {
        const v = video.current;
        if (v) {
          v.currentTime = remoteTime.current;
          if (wasPlaying.current) void v.play().catch(() => {});
        }
        void release();
      }
      wasActive.current = !!playing;
    };
    void loadSdk()
      .then(() => {
        if (!alive) return;
        const w = window as CastWindow;
        ctx = initializeCast();
        stateEvent = w.cast.framework.CastContextEventType.CAST_STATE_CHANGED;
        ctx.addEventListener(stateEvent, updateDiscovery);
        updateDiscovery();
        setAvailable(true);
        sync();
      })
      .catch((e) => {
        if (alive) {
          sdk = undefined;
          setDiscovery('UNAVAILABLE');
          setError(e instanceof Error ? e.message : 'Google Cast could not initialize.');
        }
      });
    const timer = setInterval(sync, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
      if (ctx && stateEvent) ctx.removeEventListener(stateEvent, updateDiscovery);
    };
  }, [episodeId, video]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : `Cast ${String((e as { code?: string })?.code || 'operation failed')}. Allow local network access in Chrome, check Google Cast is enabled on the TV, and use the same non-guest Wi-Fi.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (!window.isSecureContext)
      throw new Error('Casting requires HTTPS. Open the deployed Space URL.');
    if (!available || !(window as CastWindow).cast?.framework) {
      await loadSdk();
      initializeCast();
      setAvailable(true);
      throw new Error('Cast is ready. Click Cast to TV again to open the device chooser.');
    }
    const w = window as CastWindow;
    const ctx = context();
    // Open the chooser directly from the click. Do not reload or reset discovery
    // before requestSession, or lose the browser's user activation to SDK loading.
    await ctx.requestSession();
    const sessionId = /\/session\/([a-f0-9]{64})\//.exec(url)?.[1];
    if (!sessionId) throw new Error('Reopen this video before casting.');
    await release();
    const access = await post<{ ticket: string; url: string }>(
      `/playback/session/${sessionId}/cast`,
      { audio },
    );
    capability.current = { ticket: access.ticket, session: sessionId };
    const info = new w.chrome.cast.media.MediaInfo(access.url, 'application/x-mpegURL');
    info.streamType = w.chrome.cast.media.StreamType.BUFFERED;
    info.metadata = new w.chrome.cast.media.GenericMediaMetadata();
    info.metadata.title = title;
    info.customData = { yoruEpisode: episodeId };
    const request = new w.chrome.cast.media.LoadRequest(info);
    request.currentTime = active ? time : video.current?.currentTime || 0;
    request.autoplay = true;
    try {
      await ctx.getCurrentSession().loadMedia(request);
      wasPlaying.current = !video.current?.paused;
      video.current?.pause();
      setActive(true);
      wasActive.current = true;
    } catch {
      await release();
      throw new Error(
        'The TV could not load this stream. The Space must be publicly reachable; a private HF Space blocks TV playback.',
      );
    }
  }
  function seek(position: number) {
    const w = window as CastWindow;
    const request = new w.chrome.cast.media.SeekRequest();
    request.currentTime = Math.max(0, Math.min(duration || Infinity, position));
    return new Promise<void>((resolve, reject) => media()?.seek(request, resolve, reject));
  }
  return (
    <div className="yoru-cast">
      <button
        className={`button small glass ${active ? 'is-active' : ''}`}
        disabled={busy || !url}
        onClick={() => void run(start)}
        title={
          available
            ? 'Choose a TV on your Wi-Fi network'
            : 'Google Cast requires a compatible browser and TV'
        }
      >
        <Cast size={18} /> {busy ? 'Connecting…' : active ? `Casting to ${name}` : 'Cast to TV'}
      </button>
      {error && (
        <p role="alert" className="muted">
          {error}
        </p>
      )}
      {available && !active && discovery === 'NO_DEVICES_AVAILABLE' && (
        <p role="status" className="muted">
          No Google Cast devices discovered. Click Cast to TV and allow local-network access. Open
          this site's direct hf.space URL in desktop Chrome; check the TV has Google Cast enabled
          and neither device uses guest Wi-Fi or a VPN.
        </p>
      )}
      {active && (
        <div className="panel cast-remote" aria-label="TV playback controls">
          <strong>Playing on {name}</strong>
          <p className="muted">
            The TV plays audio and video together. Use these controls while casting.
          </p>
          <input
            aria-label="TV playback position"
            type="range"
            min={0}
            max={duration || 1}
            step={1}
            value={Math.min(time, duration || 1)}
            onChange={(e) => {
              setTime(Number(e.target.value));
              void run(() => seek(Number(e.target.value)));
            }}
          />
          <div className="vc-group">
            <button
              className="button small glass"
              aria-label="TV rewind 10 seconds"
              disabled={busy}
              onClick={() => void run(() => seek(time - 10))}
            >
              <RotateCcw size={18} />
            </button>
            <button
              className="button small glass"
              aria-label={paused ? 'Play on TV' : 'Pause TV'}
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    new Promise<void>((resolve, reject) =>
                      paused
                        ? media()?.play(null, resolve, reject)
                        : media()?.pause(null, resolve, reject),
                    ),
                )
              }
            >
              {paused ? <Play size={18} /> : <Pause size={18} />}
            </button>
            <button
              className="button small glass"
              aria-label="TV forward 10 seconds"
              disabled={busy}
              onClick={() => void run(() => seek(time + 10))}
            >
              <RotateCw size={18} />
            </button>
            <label>
              TV volume{' '}
              <input
                aria-label="TV volume"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  setVolume(value);
                  void run(() => context().getCurrentSession().setVolume(value));
                }}
              />
            </label>
            <button
              className="button small glass"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  remoteTime.current = media()?.getEstimatedTime() || time;
                  context().endCurrentSession(true);
                  await release();
                })
              }
            >
              <X size={18} /> Stop casting
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
