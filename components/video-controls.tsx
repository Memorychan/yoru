'use client';
import { useEffect, useRef, useState, type RefObject, type ReactNode } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings2,
  Captions,
  PictureInPicture2,
  Upload,
  SkipForward,
  LoaderCircle,
  X,
} from 'lucide-react';
function clock(value: number) {
  if (!Number.isFinite(value)) return '0:00';
  const n = Math.max(0, Math.floor(value));
  return n >= 3600
    ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
    : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}
interface Props {
  cast?: ReactNode;
  video: RefObject<HTMLVideoElement | null>;
  frame: RefObject<HTMLDivElement | null>;
  ready: boolean;
  watermark: boolean;
  onWatermark: (value: boolean) => void;
  title?: string;
  qualities: { height: number }[];
  quality: number;
  onQuality: (n: number) => void;
  audios: { name: string }[];
  audio: number;
  onAudio: (n: number) => void;
  subtitles: { label: string; url: string }[];
  subtitle: string;
  onSubtitle: (n: string) => void;
  dataSaver: boolean;
  onDataSaver: (v: boolean) => void;
  admin: boolean;
  onCaption: (file: File, label: string, save: boolean) => Promise<void>;
  onNext?: () => void;
}
export function VideoControls(p: Props) {
  const [playing, setPlaying] = useState(false),
    [waiting, setWaiting] = useState(false),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [buffer, setBuffer] = useState(0);
  const [volume, setVolume] = useState(1),
    [muted, setMuted] = useState(false),
    [speed, setSpeed] = useState(1),
    [fullscreen, setFullscreen] = useState(false),
    [pip, setPip] = useState(false);
  const [visible, setVisible] = useState(true),
    [menu, setMenu] = useState<'settings' | 'captions' | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [loop, setLoop] = useState(false),
    [boost, setBoost] = useState(100),
    [fit, setFit] = useState('contain'),
    [captionSize, setCaptionSize] = useState('100');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    fileRef = useRef<HTMLInputElement>(null),
    saveRef = useRef<HTMLInputElement>(null),
    labelRef = useRef<HTMLInputElement>(null);
  const amplifier = useRef<{ context: AudioContext; gain: GainNode } | null>(null);
  async function changeBoost(percent: number) {
    const video = p.video.current;
    if (!video) return;
    try {
      if (!amplifier.current) {
        const Context =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Context) throw new Error('unsupported');
        const context = new Context();
        try {
          const source = context.createMediaElementSource(video);
          const gain = context.createGain();
          source.connect(gain);
          gain.connect(context.destination);
          amplifier.current = { context, gain };
        } catch (error) {
          void context.close();
          throw error;
        }
      }
      const { context, gain } = amplifier.current;
      await context.resume();
      const value = Math.max(100, Math.min(300, percent));
      gain.gain.setTargetAtTime(value / 100, context.currentTime, 0.02);
      setBoost(value);
    } catch {
      setMessage(
        'Audio boost is unavailable in this browser. Normal volume controls remain available.',
      );
    }
  }
  useEffect(
    () => () => {
      void amplifier.current?.context.close();
    },
    [],
  );
  function reveal() {
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (p.video.current && !p.video.current.paused) setVisible(false);
    }, 3000);
  }
  function seek(value: number) {
    const v = p.video.current;
    if (v && Number.isFinite(v.duration)) v.currentTime = Math.max(0, Math.min(v.duration, value));
    reveal();
  }
  function skip(seconds: number) {
    const video = p.video.current;
    if (video) seek(video.currentTime + seconds);
  }
  function changeVolume(value: number) {
    const video = p.video.current;
    if (!video) return;
    const next = Math.max(0, Math.min(1, Math.round(value * 100) / 100));
    video.volume = next;
    video.muted = false;
    setVolume(next);
    setMuted(false);
    reveal();
  }
  function toggle() {
    const v = p.video.current;
    if (!v || !p.ready) return;
    void amplifier.current?.context.resume();
    if (v.paused) void v.play().catch(() => setMessage('Press play again to start the video.'));
    else v.pause();
    reveal();
  }
  async function full() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (p.frame.current?.requestFullscreen) await p.frame.current.requestFullscreen();
      else
        (
          p.video.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
        )?.webkitEnterFullscreen?.();
    } catch {
      setMessage('Fullscreen is unavailable in this browser.');
    }
  }
  async function picture() {
    try {
      const v = p.video.current;
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (v && v.readyState >= 2) await v.requestPictureInPicture();
    } catch {
      setMessage('Picture-in-picture is unavailable for this video.');
    }
  }
  useEffect(() => {
    const v = p.video.current;
    if (!v) return;
    const sync = () => {
      setPlaying(!v.paused && !v.ended);
      setTime(v.currentTime);
      setDuration(Number.isFinite(v.duration) ? v.duration : 0);
      setVolume(v.volume);
      setMuted(v.muted);
      setSpeed(v.playbackRate);
      let end = 0;
      for (let i = 0; i < v.buffered.length; i++)
        if (v.buffered.start(i) <= v.currentTime && v.buffered.end(i) >= v.currentTime)
          end = v.buffered.end(i);
      setBuffer(end);
    };
    const loading = () => setWaiting(true),
      loaded = () => setWaiting(false),
      pause = () => {
        setWaiting(false);
        setVisible(true);
      },
      fs = () => setFullscreen(document.fullscreenElement === p.frame.current);
    const events = [
      'timeupdate',
      'durationchange',
      'loadedmetadata',
      'progress',
      'play',
      'pause',
      'ended',
      'volumechange',
      'ratechange',
    ];
    events.forEach((e) => v.addEventListener(e, sync));
    v.addEventListener('waiting', loading);
    v.addEventListener('seeking', loading);
    v.addEventListener('playing', loaded);
    v.addEventListener('canplay', loaded);
    v.addEventListener('seeked', loaded);
    v.addEventListener('pause', pause);
    document.addEventListener('fullscreenchange', fs);
    const frame = p.frame.current;
    frame?.addEventListener('pointermove', reveal);
    frame?.addEventListener('pointerdown', reveal);
    frame?.addEventListener('focusin', reveal);
    setPip(!!document.pictureInPictureEnabled);
    sync();
    return () => {
      events.forEach((e) => v.removeEventListener(e, sync));
      v.removeEventListener('waiting', loading);
      v.removeEventListener('seeking', loading);
      v.removeEventListener('playing', loaded);
      v.removeEventListener('canplay', loaded);
      v.removeEventListener('seeked', loaded);
      v.removeEventListener('pause', pause);
      document.removeEventListener('fullscreenchange', fs);
      frame?.removeEventListener('pointermove', reveal);
      frame?.removeEventListener('pointerdown', reveal);
      frame?.removeEventListener('focusin', reveal);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [p.video, p.frame, p.ready]);
  useEffect(() => {
    const frame = p.frame.current;
    if (!frame) return;
    const key = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const range =
        target instanceof HTMLInputElement && target.type === 'range' && frame.contains(target);
      if (
        !p.ready ||
        e.defaultPrevented ||
        (target?.closest(
          'input,select,textarea,[contenteditable]:not([contenteditable="false"])',
        ) &&
          !range) ||
        (target?.closest('button,a') && !frame.contains(target)) ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      const v = p.video.current;
      if (!v) return;
      // Keep native button activation and volume-slider arrow adjustment accessible.
      if ((e.key === ' ' || e.key === 'Enter') && target?.closest('button,a')) return;
      if (
        range &&
        target.classList.contains('vc-volume') &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)
      ) {
        e.preventDefault();
        changeVolume(
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? 1
              : v.volume + (['ArrowRight', 'ArrowUp'].includes(e.key) ? 0.1 : -0.1),
        );
        return;
      }
      const actions: Record<string, () => void> = {
        ' ': toggle,
        k: toggle,
        ArrowLeft: () => skip(-10),
        ArrowRight: () => skip(10),
        j: () => skip(-10),
        l: () => skip(10),
        m: () => {
          v.muted = !v.muted;
        },
        f: () => void full(),
        ArrowUp: () => {
          changeVolume(v.volume + 0.1);
        },
        ArrowDown: () => {
          changeVolume(v.volume - 0.1);
        },
        Home: () => seek(0),
        End: () => seek(v.duration),
      };
      const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (action) {
        e.preventDefault();
        action();
        reveal();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });
  const shown = visible || !playing || menu !== null;
  useEffect(() => {
    const frame = p.frame.current;
    frame?.classList.toggle('cinema-idle', !shown);
    return () => {
      frame?.classList.remove('cinema-idle');
    };
  }, [shown, p.frame]);
  function button(label: string, icon: React.ReactNode, action: () => void, extra = '') {
    return (
      <button
        type="button"
        className={`vc-button ${extra}`}
        title={label}
        aria-label={label}
        onClick={action}
        disabled={!p.ready}
      >
        {icon}
      </button>
    );
  }
  return (
    <>
      <button
        className="vc-surface"
        aria-label={playing ? 'Pause video' : 'Play video'}
        onClick={toggle}
        onDoubleClick={() => void full()}
        tabIndex={-1}
      />
      {waiting && p.ready && (
        <div className="vc-buffering" role="status">
          <div className="cinema-loader">
            <span />
            <img src="/yoru-logo.png" alt="" />
            <i />
          </div>
          <span>Finding your next frame</span>
        </div>
      )}
      {!playing && p.ready && !waiting && (
        <button className="vc-big-play" aria-label="Play video" onClick={toggle}>
          <Play fill="currentColor" />
        </button>
      )}
      <div className={`vc-overlay ${shown ? 'is-visible' : ''}`}>
        <div className="vc-top">
          <span>
            <span className="vc-live-dot" /> {p.title || 'Your story'}
          </span>
          <span className="vc-top-note">YORU CINEMA</span>
        </div>
        {message && (
          <div className="vc-message" role="status">
            {message}
            <button onClick={() => setMessage('')} aria-label="Dismiss message">
              <X size={15} />
            </button>
          </div>
        )}
        {menu && (
          <section
            className="vc-menu"
            aria-label={menu === 'settings' ? 'Playback settings' : 'Caption settings'}
          >
            <header>
              <strong>{menu === 'settings' ? 'Make it yours' : 'Every word, your way'}</strong>
              <button onClick={() => setMenu(null)} aria-label="Close settings">
                <X size={17} />
              </button>
            </header>
            {menu === 'settings' ? (
              <>
                <label>
                  Playback speed
                  <select
                    value={speed}
                    onChange={(e) => {
                      if (p.video.current) p.video.current.playbackRate = Number(e.target.value);
                    }}
                  >
                    {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? 'Normal' : `${n}×`}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Audio boost
                  <select value={boost} onChange={(e) => void changeBoost(Number(e.target.value))}>
                    {[100, 125, 150, 200, 250, 300].map((value) => (
                      <option key={value} value={value}>
                        {value === 100 ? 'Normal · 100%' : `${value}%`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="vc-check">
                  <span>
                    Show Yoru watermark<small>Remembered on this device</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={p.watermark}
                    onChange={(e) => p.onWatermark(e.target.checked)}
                  />
                </label>
                <p className="vc-help">
                  For quiet audio. Higher boost can distort loud scenes. Set Normal to remove
                  amplification.
                </p>
                {!!p.qualities.length && (
                  <label>
                    Video quality
                    <select value={p.quality} onChange={(e) => p.onQuality(Number(e.target.value))}>
                      <option value={-1}>Auto · adaptive</option>
                      {p.qualities.map((q, i) => (
                        <option key={i} value={i}>
                          {q.height}p
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!!p.audios.length && (
                  <label>
                    Audio language
                    <select value={p.audio} onChange={(e) => p.onAudio(Number(e.target.value))}>
                      {p.audios.map((a, i) => (
                        <option key={i} value={i}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="vc-check">
                  <span>
                    Data saver<small>Use the lowest video quality</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={p.dataSaver}
                    onChange={(e) => p.onDataSaver(e.target.checked)}
                  />
                </label>
                <label>
                  Picture fit
                  <select
                    value={fit}
                    onChange={(e) => {
                      setFit(e.target.value);
                      if (p.video.current) p.video.current.style.objectFit = e.target.value;
                    }}
                  >
                    <option value="contain">Original · fit</option>
                    <option value="cover">Fill screen · cropped</option>
                  </select>
                </label>
                <label className="vc-check">
                  <span>Repeat video</span>
                  <input
                    type="checkbox"
                    checked={loop}
                    onChange={(e) => {
                      setLoop(e.target.checked);
                      if (p.video.current) p.video.current.loop = e.target.checked;
                    }}
                  />
                </label>
                <p className="vc-help">
                  Space / K · play & pause
                  <br />← / → · skip 10s · M · mute · F · fullscreen
                </p>
              </>
            ) : (
              <>
                <label>
                  Caption track
                  <select value={p.subtitle} onChange={(e) => p.onSubtitle(e.target.value)}>
                    <option value="off">Off</option>
                    {p.subtitles.map((s, i) => (
                      <option value={i} key={s.url}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Caption size
                  <select
                    value={captionSize}
                    onChange={(e) => {
                      setCaptionSize(e.target.value);
                      p.frame.current?.style.setProperty(
                        '--caption-size',
                        `${Number(e.target.value) * 0.24}px`,
                      );
                    }}
                  >
                    {['75', '100', '125', '150'].map((n) => (
                      <option key={n} value={n}>
                        {n}%
                      </option>
                    ))}
                  </select>
                </label>
                <div className="vc-caption-upload">
                  <label>
                    Track name
                    <input
                      ref={labelRef}
                      placeholder="English"
                      maxLength={30}
                      defaultValue="English"
                    />
                  </label>
                  {p.admin && (
                    <label className="vc-check">
                      <span>
                        Save for everyone<small>Upload encrypted captions to this movie</small>
                      </span>
                      <input type="checkbox" ref={saveRef} />
                    </label>
                  )}
                  <input
                    hidden
                    type="file"
                    ref={fileRef}
                    accept=".vtt,.srt"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      setBusy(true);
                      setMessage('');
                      try {
                        await p.onCaption(
                          file,
                          labelRef.current?.value.trim() || 'English',
                          !!saveRef.current?.checked,
                        );
                        setMessage(
                          saveRef.current?.checked
                            ? 'Captions uploaded and selected.'
                            : 'Local captions selected for this viewing.',
                        );
                      } catch (error) {
                        setMessage((error as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                  <button
                    className="vc-upload-button"
                    onClick={() => fileRef.current?.click()}
                    disabled={busy}
                  >
                    <Upload size={16} />
                    {busy ? 'Adding captions…' : 'Add caption file'}
                  </button>
                  <small>SubRip (.srt) or WebVTT (.vtt) · up to 1 MiB</small>
                </div>
              </>
            )}
          </section>
        )}
        <div className="vc-bottom">
          <div
            className="vc-seek"
            style={
              {
                '--played': `${duration ? (time / duration) * 100 : 0}%`,
                '--buffered': `${duration ? (buffer / duration) * 100 : 0}%`,
              } as React.CSSProperties
            }
          >
            <input
              type="range"
              aria-label="Seek video"
              min={0}
              max={duration || 1}
              step={0.1}
              value={Math.min(time, duration || 1)}
              disabled={!duration}
              onChange={(e) => seek(Number(e.target.value))}
            />
          </div>
          <div className="vc-toolbar">
            <div className="vc-group">
              {button(
                playing ? 'Pause (K)' : 'Play (K)',
                playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />,
                toggle,
              )}
              {button('Back 10 seconds (J)', <RotateCcw />, () => skip(-10))}
              {button('Forward 10 seconds (L)', <RotateCw />, () => skip(10))}
              {button(
                muted ? 'Unmute (M)' : 'Mute (M)',
                muted || volume === 0 ? <VolumeX /> : <Volume2 />,
                () => {
                  if (p.video.current) p.video.current.muted = !muted;
                },
              )}
              <input
                className="vc-volume"
                aria-label="Volume"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
              />
              <span className="vc-time">
                {clock(time)} <span>/ {clock(duration)}</span>
              </span>
            </div>
            <div className="vc-group">
              {p.cast}
              {p.onNext && button('Next episode', <SkipForward />, p.onNext, 'vc-optional')}
              {button(
                'Captions',
                <Captions />,
                () => setMenu(menu === 'captions' ? null : 'captions'),
                p.subtitle !== 'off' ? 'is-active' : '',
              )}
              {button('Playback settings', <Settings2 />, () =>
                setMenu(menu === 'settings' ? null : 'settings'),
              )}
              {pip &&
                button(
                  'Picture in picture',
                  <PictureInPicture2 />,
                  () => void picture(),
                  'vc-optional',
                )}
              {button(
                fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)',
                fullscreen ? <Minimize /> : <Maximize />,
                () => void full(),
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
