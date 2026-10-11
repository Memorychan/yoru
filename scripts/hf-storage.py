"""Narrow adapter to the official HF SDK. Never print tokens or SDK error bodies."""
import json
import sys
import time
import re
import io
import contextlib
from huggingface_hub import HfApi, batch_bucket_files, download_bucket_files

def perform(request):
    token = request['token']
    bucket = request.get('bucket')
    operation = request['op']
    api = HfApi(token=token)
    if operation == 'discover':
        identity = api.whoami()
        namespaces = [identity['name']] + [x['name'] for x in identity.get('orgs', [])]
        namespace = request.get('namespace') or identity['name']
        buckets = [{'id': b.id, 'private': b.private, 'size': b.size or 0} for b in api.list_buckets(namespace=namespace)]
        print(json.dumps({'ok': True, 'username': identity['name'], 'namespaces': namespaces, 'namespace': namespace, 'buckets': buckets}))
        return
    if operation == 'create':
        api.create_bucket(bucket, private=request.get('private', False), exist_ok=False)
    elif operation == 'visibility':
        api.update_bucket_settings(bucket, private=request['private'])
    if operation == 'check':
        info = api.bucket_info(bucket)
        print(json.dumps({'ok': True, 'private': info.private, 'size': info.size or 0, 'totalFiles': info.total_files or 0}))
        return
    elif operation == 'upload':
        batch_bucket_files(bucket, add=[(x['local'], x['object']) for x in request['files']], token=token)
    elif operation == 'download':
        download_bucket_files(bucket, files=[(request['object'], request['local'])], token=token)
    elif operation == 'download-many':
        download_bucket_files(bucket, files=[(f['object'], f['local']) for f in request['files']], token=token)
    elif operation not in ('create', 'visibility'):
        raise ValueError('Unknown operation')
    print(json.dumps({'ok': True}))

def failure(error):
    # Inspect nested SDK errors internally, but never expose signed URLs or tokens.
    chain, seen = [], set()
    current = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        chain.append(current)
        current = current.__cause__ or current.__context__
    status = next((getattr(getattr(e, 'response', None), 'status_code', None)
                   for e in chain if getattr(getattr(e, 'response', None), 'status_code', None)), None)
    detail = ' '.join(type(e).__name__ + ' ' + str(e) for e in chain).lower()
    if status is None:
        wrapped_status = re.search(r'(?:http status(?: client| server)? error|status code)\s*[:=(]?\s*(\d{3})\b', detail)
        if wrapped_status:
            status = int(wrapped_status.group(1))
    messages = {401: 'Hugging Face rejected this token. Create a valid access token in your HF account.',
                    403: 'Hugging Face denied access. The token needs write permission for this namespace; also check your HF storage allowance.',
                    404: 'The bucket was not found or the token cannot access it. Create a bucket here or select an accessible one.',
                    409: 'A bucket with this name already exists. Choose Connect existing or use a different name.',
                    429: 'Hugging Face is rate limiting this account. Wait briefly and retry.'}
    if status in messages:
        return {'ok': False, 'code': f'HF_HTTP_{status}', 'retryable': status == 429,
                'message': messages[status]}
    network = any(word in detail for word in (
        'connectionreset', 'connection reset', '10054', 'error sending request',
        'incompletemessage', 'connecterror', 'readerror', 'timeout', 'timed out',
        'remoteprotocolerror', 'server disconnected', 'connectionerror',
        'connection aborted', 'connection closed', 'broken pipe',
        'dns', 'name resolution', 'request middleware error'))
    if network or (status and status >= 500):
        return {'ok': False, 'code': 'HF_NETWORK', 'retryable': True,
                'message': 'The connection to Hugging Face was reset or timed out after retries. This is not a token-permission rejection. Saved encrypted files are retained; retry from checkpoints when the connection is stable.'}
    # Extract SDK exception identifiers only, not response bodies, paths or URLs.
    identifiers = sorted(set(re.findall(r'\b[A-Za-z]+(?:Error|Failure|Exception)\b', ' '.join(str(e) for e in chain))))
    diagnostic = ', '.join(identifiers[:6]) or type(error).__name__
    return {'ok': False, 'code': 'HF_OPERATION_FAILED', 'retryable': False,
            'message': f'Hugging Face storage operation failed ({diagnostic}). No permission denial was reported. Saved checkpoints are retained.'}

def main(request=None):
    if request is None:
        request = json.load(sys.stdin)
    # Retry only idempotent transfers, with identical object names and ciphertext.
    # Downloads used by playback retain their short response-time budget.
    attempts = 4 if request.get('op') in ('upload', 'download-many', 'check', 'discover') else 1
    for attempt in range(attempts):
        try:
            perform(request)
            return
        except Exception as error:
            result = failure(error)
            if not result['retryable'] or attempt == attempts - 1:
                print(json.dumps(result))
                return
            print(f"HF transfer connection interrupted; retrying the same batch ({attempt + 2}/{attempts}).", file=sys.stderr, flush=True)
            time.sleep(min(20, 2 ** (attempt + 1)))

if __name__ == '__main__':
    if '--serve' in sys.argv:
        # Reuse SDK HTTP/Xet sessions across segment downloads. Credentials stay on stdin.
        for line in sys.stdin:
            try:
                request = json.loads(line)
                if request.get('op') != 'download':
                    raise ValueError('Download service only accepts downloads')
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    main(request)
                sys.stdout.write(output.getvalue().strip() + '\n')
                sys.stdout.flush()
            except Exception as error:
                print(json.dumps(failure(error)), flush=True)
    else:
        main()
