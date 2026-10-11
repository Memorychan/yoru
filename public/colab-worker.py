# Paste this file into ONE Google Colab cell with a GPU runtime.
# The connection key is entered privately; never share it or notebook outputs containing it.
import sys, subprocess, time, os, json, hashlib, threading, shutil
from pathlib import Path
from getpass import getpass
from urllib.parse import urlparse

subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'requests'], check=True)
import requests
if not shutil.which('ffmpeg'):
    subprocess.run(['apt-get','-qq','update'], check=True)
    subprocess.run(['apt-get','-qq','install','-y','ffmpeg'], check=True)

ORIGIN = input('Yoru direct HTTPS origin [https://kishankrish19-nexus-tts-engine.hf.space]: ').strip() or 'https://kishankrish19-nexus-tts-engine.hf.space'
if urlparse(ORIGIN).scheme != 'https':
    raise ValueError('Use your direct HTTPS website origin.')
ORIGIN = ORIGIN.rstrip('/')
KEY = getpass('Paste the temporary key from Admin > Colab GPU: ').strip()
CQ = 26  # GPU quality setting; compare visual quality before changing.
http = requests.Session()
http.headers['Authorization'] = 'Bearer ' + KEY

def call(path, payload=None):
    response = http.post(ORIGIN + '/api/colab/' + path, json=payload or {}, timeout=180)
    if not response.ok:
        raise RuntimeError(f'Yoru HTTP {response.status_code}: {response.text[:500]}')
    return response.json()

def tool(args):
    result = subprocess.run([str(x) for x in args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-1800:])
    return result.stdout

tool(['ffmpeg','-v','error','-f','lavfi','-i','color=size=640x360:rate=24','-t','1','-c:v','h264_nvenc','-preset','p4','-f','null','-'])
print('NVENC ready. Leave this notebook connected. Stop the cell to stop claiming jobs.')
ROOT = Path('/content/yoru-colab')
ROOT.mkdir(exist_ok=True)
while True:
    job = call('claim')
    if job.get('idle'):
        print('Waiting for a queued episode…', flush=True)
        time.sleep(20)
        continue
    jid = job['id']
    http.headers['X-Yoru-Colab-Lease'] = job['lease']
    folder = ROOT / jid
    folder.mkdir(exist_ok=True)
    source = folder / 'source.mkv'
    stop = threading.Event()
    state = {'progress': 0, 'detail': 'Colab downloading source'}
    def heartbeat():
        while not stop.wait(15):
            try: call(jid + '/heartbeat', dict(state))
            except Exception as error: print('Heartbeat warning:', str(error), flush=True)
    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    try:
        print('Processing:', job['filename'], flush=True)
        if shutil.disk_usage(ROOT).free < int(job['totalBytes']) * 8 + 1024**3:
            raise RuntimeError('Not enough free Colab disk.')
        # Check source inventory; a retained local source can be reused on reclaim.
        def valid_source():
            if not source.exists() or source.stat().st_size != int(job['totalBytes']): return False
            expected = job.get('chunkHashes', [])
            if not expected: return False
            with source.open('rb') as handle:
                return all(hashlib.sha256(handle.read(8 * 1024**2)).hexdigest() == item for item in expected)
        if not valid_source():
            with http.get(ORIGIN + '/api/colab/' + jid + '/source', stream=True, timeout=(30,180)) as response:
                response.raise_for_status()
                with source.open('wb') as handle:
                    for block in response.iter_content(1024**2): handle.write(block)
            if source.stat().st_size != int(job['totalBytes']): raise RuntimeError('Incomplete source download.')
            if job.get('chunkHashes') and not valid_source(): raise RuntimeError('Source hash verification failed.')
        metadata = json.loads(tool(['ffprobe','-v','error','-show_streams','-show_format','-of','json',source]))
        duration = float(metadata['format']['duration'])
        video = next(s for s in metadata['streams'] if s['codec_type'] == 'video')
        heights = [h for h in [360,720,1080] if h <= video['height']] or [max(2, video['height']//2*2)]
        audios = [s for s in metadata['streams'] if s['codec_type'] == 'audio'][:8]
        gpu_filter = False
        try:
            tool(['ffmpeg','-v','error','-hwaccel','cuda','-hwaccel_output_format','cuda','-i',source,'-t','1','-map','0:v:0','-an','-vf',f'scale_cuda=w=-2:h={heights[0]}:format=yuv420p','-c:v','h264_nvenc','-f','null','-'])
            gpu_filter = True
        except Exception:
            print('GPU decoding/scaling unavailable; using CPU decoding/scaling with GPU encoding.')
        tasks = [(f'audio{i}', ['-map',f"0:{track['index']}",'-vn','-c:a','aac','-b:a','128k'], False) for i,track in enumerate(audios)]
        for height in heights:
            args = ['-map','0:v:0','-an','-vf',f'scale_cuda=w=-2:h={height}:format=yuv420p' if gpu_filter else f'scale=-2:{height}', '-c:v','h264_nvenc','-preset','p4','-rc','vbr','-cq',str(CQ),'-b:v','0','-force_key_frames','expr:gte(t,n_forced*6)','-sc_threshold','0']
            if not gpu_filter: args += ['-pix_fmt','yuv420p']
            tasks.append((f'v{height}', args, gpu_filter))
        for index,(name,args,use_gpu_decode) in enumerate(tasks):
            state.update(progress=100 * index / len(tasks), detail='Colab encoding ' + name)
            print(state['detail'], flush=True)
            done = folder / (name + '.done')
            if not done.exists():
                command = ['ffmpeg','-hide_banner','-loglevel','error','-y']
                if use_gpu_decode: command += ['-hwaccel','cuda','-hwaccel_output_format','cuda']
                command += ['-i',source] + args + ['-f','hls','-hls_time','6','-hls_playlist_type','vod','-hls_segment_filename',folder / (name + '-%05d.ts'),folder / (name + '.m3u8')]
                tool(command)
                done.write_text('complete')
            playlist = folder / (name + '.m3u8')
            segments = [folder / line for line in playlist.read_text().splitlines() if line and not line.startswith('#')]
            state['detail'] = 'Returning ' + name + ' to Yoru'
            for path in [*segments, playlist]:
                expected = hashlib.sha256(path.read_bytes()).hexdigest()
                for attempt in range(8):
                    try:
                        with path.open('rb') as handle:
                            response = http.post(ORIGIN + '/api/colab/' + jid + '/files/' + path.name, files={'file': (path.name,handle,'application/octet-stream')}, timeout=180)
                        if not response.ok:
                            message = f'Rendition {path.name} ({path.stat().st_size} bytes) upload HTTP {response.status_code}: {response.text[:300]}'
                            if response.status_code in (400, 401, 403, 413, 507):
                                raise ValueError(message)
                            raise RuntimeError(message)
                        if response.json()['hash'] != expected: raise RuntimeError('Returned file hash mismatch.')
                        break
                    except ValueError:
                        raise
                    except Exception as error:
                        if attempt == 7: raise
                        delay = min(60, 2**(attempt + 1))
                        print(f'Retrying {path.name} in {delay}s ({attempt + 1}/8): {error}', flush=True)
                        time.sleep(delay)
        state.update(progress=100, detail='Colab rendition handoff')
        call(jid + '/complete')
        print('Renditions accepted. Yoru will encrypt, upload and verify:', job['filename'], flush=True)
        stop.set(); thread.join()
        shutil.rmtree(folder)
    except Exception as error:
        print('Job interrupted:', str(error), flush=True)
        print('Completed local renditions are retained. Re-run this cell after the 15-minute job lease expires, or release the job in Yoru.')
        stop.set(); thread.join()
        raise
    finally:
        stop.set()
