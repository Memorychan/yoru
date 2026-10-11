'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Hls from 'hls.js';
import { ArrowLeft, SkipForward, AlertCircle } from 'lucide-react';
import { post } from '@/lib/api';
import type { Title } from '@/lib/types';
import { Shell, useUser } from './shell';
import { VideoControls } from './video-controls';
import { captionText } from '@/lib/captions';
import { CastControls } from './cast-controls';
import { useData, ErrorBox, Loading } from './ui';
interface Playback {
  url: string;
  position: number;
  watermark: string;
  subtitles: { label: string; url: string }[];
}
type NativeAudio = { enabled: boolean; label?: string; language?: string };
type NativeAudioList = ArrayLike<NativeAudio> & EventTarget;
type NativeVideo = HTMLVideoElement & { audioTracks?: NativeAudioList };
function PlayerContent({ id, preview = false }: { id: string; preview?: boolean }) {
  const router = useRouter();
  const catalog = useData<Title[]>(preview ? '/admin/titles' : '/catalog');
  const ref = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const user = useUser();
  const [localTracks, setLocalTracks] = useState<Playback['subtitles']>([]);
  const localUrls = useRef<string[]>([]);
  const hlsRef = useRef<Hls | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [error, setError] = useState('');
  const [qualities, setQualities] = useState<{ height: number }[]>([]);
  const [quality, setQuality] = useState(-1);
  const [audios, setAudios] = useState<{ name: string }[]>([]);
  const [audio, setAudio] = useState(0);
  const [time, setTime] = useState(0);
  const [retry, setRetry] = useState(0);
  const [dataSaver, setDataSaver] = useState(false);
  const [subtitle, setSubtitle] = useState('off');
  const [showWatermark, setShowWatermark] = useState(false);
  const [autoSkip, setAutoSkip] = useState(false);
  useEffect(() => {
    setAutoSkip(localStorage.getItem('yoru-auto-skip') === 'true');
  }, []);
  useEffect(() => {
    setShowWatermark(localStorage.getItem('yoru-watermark') === 'true');
  }, []);
  const title = catalog.data?.find((t) => t.episodes.some((e) => e.id === id));
  const episode = title?.episodes.find((e) => e.id === id);
  useEffect(() => {
    const video = ref.current;
    if (!video || !autoSkip || title?.category !== 'ANIME' || title.format !== 'SERIES' || !episode)
      return;
    const skip = () => {
      if (video.paused || video.seeking) return;
      for (const [start, end] of [
        [episode.introStart, episode.introEnd],
        [episode.outroStart, episode.outroEnd],
      ]) {
        if (
          end > start &&
          video.currentTime >= start &&
          video.currentTime < end &&
          end <= video.duration
        ) {
          video.currentTime = end;
          break;
        }
      }
    };
    video.addEventListener('timeupdate', skip);
    return () => video.removeEventListener('timeupdate', skip);
  }, [episode, autoSkip, title?.category, title?.format, playback]);
  const next = title?.episodes[(title?.episodes.findIndex((e) => e.id === id) ?? -1) + 1];
  const tracks = [...(playback?.subtitles || []), ...localTracks];
  useEffect(() => {
    setLocalTracks([]);
    return () => {
      localUrls.current.forEach(URL.revokeObjectURL);
      localUrls.current = [];
    };
  }, [id]);
  async function addCaption(file: File, label: string, save: boolean) {
    if (file.size > 1024 * 1024) throw new Error('Caption files must be 1 MiB or smaller.');
    if (!/\.(srt|vtt)$/i.test(file.name)) throw new Error('Choose an .srt or .vtt caption file.');
    const text = captionText(await file.text());
    if (save) {
      if (user?.role !== 'ADMIN') throw new Error('Only admins can save captions for everyone.');
      await post(`/admin/subtitles/${id}`, { language: label, text });
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
    localUrls.current.push(url);
    setSubtitle(String((playback?.subtitles.length || 0) + localTracks.length));
    setLocalTracks((current) => [...current, { label, url }]);
  }
  useEffect(() => {
    if (!playback) return;
    const preferred = localStorage.getItem('yoru-subtitle');
    const index = playback.subtitles.findIndex((s) => s.label === preferred);
    setSubtitle(index >= 0 ? String(index) : 'off');
  }, [playback]);
  useEffect(() => {
    let alive = true;
    setError('');
    setPlayback(null);
    setTime(0);
    setQuality(-1);
    setQualities([]);
    setAudios([]);
    setAudio(0);
    setDataSaver(false);
    post<Playback>(`/playback/${id}`, { preview })
      .then((p) => {
        if (alive) setPlayback(p);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [id, retry, preview]);
  useEffect(() => {
    const video = ref.current;
    if (!video || !playback) return;
    let hls: Hls | null = null;
    const nativeAudio = (video as NativeVideo).audioTracks;
    const syncNativeAudio = () => {
      if (!nativeAudio || hls) return;
      const list = Array.from(nativeAudio);
      setAudios(
        list.map((track, index) => ({
          name: track.label || track.language || `Track ${index + 1}`,
        })),
      );
      const selected = list.findIndex((track) => track.enabled);
      setAudio(Math.max(0, selected));
    };
    let lastSaved = 0;
    const restore = () => {
      if (playback.position > 0 && playback.position < video.duration - 20)
        video.currentTime = playback.position;
      if (
        new URLSearchParams(window.location.search).get('autoplay') === '1' &&
        localStorage.getItem('yoru-autonext') === 'true'
      )
        void video.play().catch(() => {});
    };
    video.addEventListener('loadedmetadata', restore, { once: true });
    video.addEventListener('loadedmetadata', syncNativeAudio);
    nativeAudio?.addEventListener('addtrack', syncNativeAudio);
    nativeAudio?.addEventListener('change', syncNativeAudio);
    if (Hls.isSupported()) {
      hls = new Hls({
        maxBufferLength: 30,
        backBufferLength: 30,
        maxMaxBufferLength: 60,
        startPosition: playback.position || 0,
        startLevel: 0,
      });
      hlsRef.current = hls;
      if (localStorage.getItem('yoru-data-saver') === 'true') hls.autoLevelCapping = 0;
      hls.loadSource(playback.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setQualities(hls!.levels.map((l) => ({ height: l.height })));
        setAudios(hls!.audioTracks.map((a) => ({ name: a.name })));
        const preferred = localStorage.getItem('yoru-audio');
        const index = hls!.audioTracks.findIndex((a) => a.name === preferred);
        if (index >= 0) {
          hls!.audioTrack = index;
          setAudio(index);
        }
        if (localStorage.getItem('yoru-data-saver') === 'true') {
          hls!.autoLevelCapping = 0;
          setDataSaver(true);
        }
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        setAudios(hls!.audioTracks.map((a) => ({ name: a.name || a.lang || 'Audio' })));
      });
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => setAudio(data.id));
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal)
          setError(
            'Playback was interrupted. Reopen the stream to renew access or retry the connection.',
          );
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = playback.url;
    else
      setError(
        'This browser does not support HLS playback. Use a current Chrome, Firefox, Edge or Safari browser.',
      );
    const save = () => {
      if (!preview && video.currentTime > 0)
        void post(`/progress/${id}`, { seconds: video.currentTime }).catch(() => {});
    };
    const seek = () => {
      // Cancel downloads for the old position and request the destination directly.
      // Already buffered jumps need no network restart.
      for (let i = 0; i < video.buffered.length; i++) {
        if (
          video.currentTime >= video.buffered.start(i) &&
          video.currentTime < video.buffered.end(i)
        )
          return;
      }
      if (hls) {
        hls.stopLoad();
        hls.startLoad(video.currentTime);
      }
    };
    video.addEventListener('seeking', seek);
    const onTime = () => {
      setTime(video.currentTime);
      if (Date.now() - lastSaved > 15000) {
        lastSaved = Date.now();
        save();
      }
    };
    const onError = () =>
      setError('This video could not be played. Check your connection and try again.');
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('pause', save);
    video.addEventListener('ended', save);
    video.addEventListener('error', onError);
    return () => {
      save();
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('seeking', seek);
      video.removeEventListener('pause', save);
      video.removeEventListener('ended', save);
      video.removeEventListener('error', onError);
      video.removeEventListener('loadedmetadata', restore);
      video.removeEventListener('loadedmetadata', syncNativeAudio);
      nativeAudio?.removeEventListener('addtrack', syncNativeAudio);
      nativeAudio?.removeEventListener('change', syncNativeAudio);
      hls?.destroy();
      hlsRef.current = null;
    };
  }, [playback, id, preview]);
  useEffect(() => {
    if (!ref.current) return;
    Array.from(ref.current.textTracks).forEach((track, i) => {
      track.mode = subtitle === String(i) ? 'showing' : 'disabled';
    });
  }, [subtitle, playback, localTracks]);
  return (
    <div className="player-page">
      <Link
        className="back-link"
        href={preview ? '/admin' : title ? `/title/${title.id}` : '/browse'}
      >
        <ArrowLeft size={17} /> Back to {title?.name || 'browse'}
      </Link>
      {error && <ErrorBox message={error} retry={() => setRetry((v) => v + 1)} />}
      <div
        className="video-frame"
        ref={frame}
        tabIndex={0}
        aria-label="Video player. Space to play; arrow keys to seek."
      >
        {!playback && !error && <Loading />}
        <video
          ref={ref}
          playsInline
          preload="metadata"
          poster={title?.backdrop}
          crossOrigin="use-credentials"
          onEnded={() => {
            if (next?.asset && localStorage.getItem('yoru-autonext') === 'true') {
              router.push(`/watch/${next.id}?autoplay=1${preview ? '&preview=1' : ''}`);
            }
          }}
        >
          {tracks.map((s, i) => (
            <track
              key={s.url}
              kind="subtitles"
              src={s.url}
              label={s.label}
              onLoad={() => {
                const v = ref.current;
                if (v)
                  Array.from(v.textTracks).forEach((t, n) => {
                    t.mode = subtitle === String(n) ? 'showing' : 'disabled';
                  });
              }}
            />
          ))}
        </video>
        <VideoControls
          cast={
            playback && (
              <CastControls
                key={id}
                video={ref}
                url={playback.url}
                title={episode?.name || title?.name || 'Yoru'}
                episodeId={id}
                audio={audio}
              />
            )
          }
          watermark={showWatermark}
          onWatermark={(value) => {
            setShowWatermark(value);
            localStorage.setItem('yoru-watermark', String(value));
          }}
          video={ref}
          frame={frame}
          ready={!!playback && !error}
          title={episode?.name}
          qualities={qualities}
          quality={quality}
          onQuality={(value) => {
            setQuality(value);
            if (hlsRef.current) {
              hlsRef.current.autoLevelCapping = -1;
              hlsRef.current.currentLevel = value;
            }
            setDataSaver(false);
            localStorage.setItem('yoru-data-saver', 'false');
          }}
          audios={audios}
          audio={audio}
          onAudio={(value) => {
            setAudio(value);
            if (hlsRef.current) hlsRef.current.audioTrack = value;
            else {
              const native = (ref.current as NativeVideo | null)?.audioTracks;
              if (native)
                Array.from(native).forEach((track, index) => {
                  track.enabled = index === value;
                });
            }
            localStorage.setItem('yoru-audio', audios[value].name);
          }}
          subtitles={tracks}
          subtitle={subtitle}
          onSubtitle={(value) => {
            setSubtitle(value);
            localStorage.setItem(
              'yoru-subtitle',
              value === 'off' ? 'off' : tracks[Number(value)].label,
            );
          }}
          dataSaver={dataSaver}
          onDataSaver={(value) => {
            setDataSaver(value);
            setQuality(-1);
            localStorage.setItem('yoru-data-saver', String(value));
            if (hlsRef.current) {
              hlsRef.current.currentLevel = -1;
              hlsRef.current.autoLevelCapping = value ? 0 : -1;
            }
          }}
          admin={user?.role === 'ADMIN'}
          onCaption={addCaption}
          onNext={
            next?.asset
              ? () => router.push(`/watch/${next.id}${preview ? '?preview=1' : ''}`)
              : undefined
          }
        />
        {playback && showWatermark && (
          <span className="watermark">yoru · {playback.watermark}</span>
        )}
        {episode && time >= episode.outroStart && time < episode.outroEnd && (
          <button
            className="button skip-intro"
            onClick={() => {
              if (ref.current) ref.current.currentTime = episode.outroEnd;
            }}
          >
            Skip ending <SkipForward size={16} />
          </button>
        )}
        {episode && time >= episode.introStart && time < episode.introEnd && (
          <button
            className="button skip-intro"
            onClick={() => {
              if (ref.current) ref.current.currentTime = episode.introEnd;
            }}
          >
            Skip intro <SkipForward size={16} />
          </button>
        )}
      </div>
      <div className="player-info">
        {title?.category === 'ANIME' && title.format === 'SERIES' && (
          <label>
            <input
              type="checkbox"
              checked={autoSkip}
              onChange={(e) => {
                setAutoSkip(e.target.checked);
                localStorage.setItem('yoru-auto-skip', String(e.target.checked));
              }}
            />{' '}
            Auto-skip opening and ending
          </label>
        )}
        <div>
          <span className="eyebrow">
            {title?.format === 'SERIES'
              ? `SEASON ${episode?.season} · EPISODE ${episode?.number}`
              : 'NOW PLAYING'}
          </span>
          <h1>{episode?.name || 'Your story is loading'}</h1>
          <p>{title?.name}</p>
        </div>
        {next && (
          <Link className="button glass" href={`/watch/${next.id}${preview ? '?preview=1' : ''}`}>
            Next episode <SkipForward size={18} />
          </Link>
        )}
      </div>
    </div>
  );
}
export function Player({ id, preview = false }: { id: string; preview?: boolean }) {
  return (
    <Shell>
      <PlayerContent id={id} preview={preview} />
    </Shell>
  );
}
