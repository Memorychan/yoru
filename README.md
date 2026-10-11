---
title: Yoru
emoji: 🌙
colorFrom: red
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# Yoru

A private streaming application for you and your friends. Next.js and React provide the viewing experience; a NestJS API handles membership and payments; a separate media gateway handles playback; a BullMQ worker transcodes and encrypts video before uploading it to Hugging Face Storage Buckets.

## Included

- Responsive cinematic interface, original artwork, discovery, search and category/language/access filters.
- Invite-only registration, server-side admin authorization, session cookies, optional authenticator MFA and one-use recovery codes.
- Movies and series with seasons and episodes, custom posters/backdrops, featured titles, reorderable home carousels.
- Free access, one-time purchases, and rentals. Series products cover the whole title, including future episodes added to that title.
- Razorpay Orders/Checkout, signature checks, capture verification, webhook reconciliation, purchase history and full refunds.
- Admin-only resumable uploads, background FFmpeg processing, progress queue and retries.
- Admin bucket creation and account/organization discovery, multiple HF connections, encrypted tokens, visibility controls, credential rotation and independent upload-pausing.
- Encrypted storage copies, primary-storage migration and automatic playback fallback to completed copies.
- AES-256-GCM encryption of video segments and subtitle files, random object paths, private manifests and wrapped per-asset keys.
- Adaptive HLS, multiple source audio tracks, WebVTT subtitles, intro skipping, next episode, progress, watchlist, data saver and admin draft previews.

## First start: all services in Docker

Docker Desktop with a working engine is required for this optional route. Native Windows startup below does not require Docker or WSL. This configuration starts locally; it does not publish a public site.

1. From this project folder, run `npm run setup:env`.
2. Edit `.env`. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 12 characters). The setup script generates `MASTER_KEY`; preserve it securely. Do not put secrets in chat or source control.
3. Run:

   ```powershell
   docker compose -f docker-compose.yml -f docker-compose.app.yml up --build
   ```

4. Open http://localhost:3000 and sign in with your admin credentials.
5. Open Admin studio > Storage & buckets > Add HF account. Enter a write-enabled HF access token and click Find my account. Select your account or organization, then Create a new bucket (public or private) or Connect existing. Give the connection a name and save. Bucket creation happens inside the admin studio.
6. Add a title, choose its pricing, upload media, wait until READY, preview it, and publish it.
7. Use Your circle to create an invitation link. Share the link yourself.

The admin is created only if its email does not exist. Running seed again does not change existing passwords or overwrite titles. `SEED_SHOWCASE=true` creates three clearly labeled artwork-only entries; set it to `false` for an empty library. Sample entries cannot be purchased or streamed. They can be unpublished, edited and given real media.

## Native development on Windows

Prerequisites: Node.js 22 or newer, Python 3.10 or newer, and FFmpeg/FFprobe. PostgreSQL binaries come with the npm dependencies. The installer below downloads a SHA-256-verified portable Windows Redis build inside `tools/`. No Windows services or WSL are needed.

```powershell
npm install
npm run setup:env
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm run local:install
npm run local:start
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

Before seeding, set admin credentials in `.env`. Set `PYTHON_BIN` to the absolute path of `.venv\Scripts\python.exe`. Set `FFMPEG_BIN` and `FFPROBE_BIN` to absolute executable paths if those tools are not on PATH. The API, media gateway, worker and web server must run from the project root. All four share the same `.env`; server processes share `DATA_DIR`.

`npm run dev` first ensures local PostgreSQL and Redis are running, then starts the website at port 3000, API at 4000, media gateway at 4001, media worker and configured encrypted backup scheduler. Database and queue files persist in `data/postgres` and `data/redis`. Keep the app processes running for encoding and backups. FFmpeg is deliberately outside the website process.

The existing development installation was migrated from Supabase to local PostgreSQL, with all application rows verified. Do not seed or migrate it again. Just run `npm run dev`. See [local data and HF Space deployment](docs/LOCAL_DATABASE_AND_SPACES.md) for backups, recovery, and required Space secrets.

For a UI-only view without any accounts, database or media services:

```powershell
npm run dev:web
```

Open http://localhost:3000/preview. This is an explicitly labeled design preview with fictional artwork entries; it does not simulate payments, uploads or playback.

## Configuration

| Variable                                 | Purpose                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`                           | PostgreSQL connection string                                                              |
| `REDIS_URL`                              | Redis for processing queue, auth limits and short-lived ciphertext cache                  |
| `MASTER_KEY`                             | 64 hexadecimal characters; wraps storage tokens, media keys and MFA secrets               |
| `APP_ORIGIN`                             | Exact browser origin, including scheme and port; used for CSRF protection and invitations |
| `API_INTERNAL_URL`                       | Next.js proxy destination; set before building the web app                                |
| `GATEWAY_INTERNAL_URL`, `GATEWAY_PORT`   | Media proxy destination (build-time) and gateway port (default 4001)                      |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`          | Initial admin bootstrap credentials                                                       |
| `DATA_DIR`                               | Private staging/processing directory; shared by API and worker                            |
| `PYTHON_BIN`                             | Python executable containing the official HF SDK                                          |
| `FFMPEG_BIN`, `FFPROBE_BIN`              | FFmpeg executable locations                                                               |
| `MAX_UPLOAD_GB`                          | Maximum original video size, default 10 GB                                                |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay credentials, preferably Test Mode while you evaluate                             |
| `RAZORPAY_WEBHOOK_SECRET`                | Separate webhook signing secret                                                           |

HF credentials are entered in the admin interface and stored encrypted in PostgreSQL. The browser is never sent saved HF tokens, media keys, or provider secret keys.

## Supabase database

For native development, set `DATABASE_URL` to the Supabase **session pooler** connection string on port 5432. Append `?sslmode=require&connection_limit=3&pool_timeout=10&connect_timeout=10` (use `&` if the URL already has query parameters). Preserve the dashboard-provided host and username, and URL-encode special characters in the password. Each API, gateway and worker has its own pool; keeping each small avoids consuming the session pool with development processes. Session mode supports this Prisma application and schema commands; do not blindly switch to transaction mode on port 6543. See [Supabase's Prisma guide](https://supabase.com/docs/guides/database/prisma).

After a code update, apply the schema with `npm run db:push` and restart all application processes. `P2021` means a missing table and `P2022` a missing column; valid credentials alone do not mean the schema is current. `node scripts/diagnose-db.cjs` provides read-only diagnostics without printing credentials or record contents. The one-time `prisma/supabase-update.sql` repair adds the storage-copy tables to an older installation; it has already been applied to the configured database and should not be rerun there.

The existing Docker compose setup intentionally uses its local PostgreSQL and Redis containers, overriding `.env` for those connections. Use the native startup instructions with Supabase, or change the compose overrides deliberately before using a hosted database with Docker.

## Razorpay setup

Free viewing works without Razorpay. For purchases and rentals, fill all three Razorpay variables and restart the API. Enable automatic capture in your Razorpay account. Use credentials from the same mode throughout.

The webhook endpoint is `/api/payments/webhook`. Configure `payment.captured`, `order.paid`, and `refund.processed`. Razorpay needs a reachable HTTPS webhook URL; it cannot call localhost. An HTTPS tunnel or a private deployment with a reachable webhook is needed for asynchronous events. Checkout verification also fetches the payment server-side, so successful return flows can grant access without waiting for a webhook.

Never mark a client-side checkout callback as paid by itself. The server verifies the signature, order ownership, amount, currency and captured status. Duplicate events and grants are idempotent. Refund events revoke access from the refunded order. A partial refund received externally also revokes that order's access; the app itself exposes full refunds only.

Rentals start when captured payment is reconciled and expire after the configured number of hours. They are checked again on every media request. Already buffered seconds may continue briefly. Changing prices creates a new product version; existing entitlements remain valid. A purchase is access while the title remains available, not a promise of perpetual distribution.

## Media pipeline and storage

1. Admin creates a title and movie/episode record.
2. The browser uploads 8 MiB chunks into private local staging. SHA-256 chunk checksums and durable database offsets allow resuming from the upload detail page after reselecting the original file, even after clearing browser storage.
3. A separate worker uses FFprobe and FFmpeg, builds up to 360p/720p/1080p without upscaling, and includes up to eight source audio tracks.
4. Each segment is authenticated and encrypted with AES-256-GCM. A random 12-byte nonce is generated per encryption; object paths are bound as authenticated data. Per-asset keys are wrapped under the master key.
5. Only encrypted `.bin` objects are uploaded to HF. Playlists and the mapping from segment names to random objects remain in the private database. Video names and plaintext originals are not uploaded to HF.
6. The worker downloads every encrypted object to verify its checksum and authentication before marking the asset READY. READY does not publish the title automatically.
7. The admin can preview a draft, add encrypted WebVTT subtitles, and publish when all episodes have media.
8. The authenticated media endpoint checks membership, playback session and entitlement before decrypting a segment. Browser-compatible HLS is sent over the same origin. A short-lived cache holds ciphertext only.

The worker's transfer verification is part of the application's runtime implementation; the development agent did not execute uploads, playback or tests.

FFmpeg temporarily needs plaintext source and rendition files in private staging. Successful jobs remove those local files; failed jobs retain the source and completed processing checkpoints for retry. Allow disk headroom for the original plus multiple renditions. Encrypted source bytes remain publicly downloadable from a public bucket; they cannot be opened as video without keys. Authorized playback can still be recorded. The visible watermark is a deterrent, not DRM.

Pausing a storage connection stops new uploads and keeps old media readable. In Content, open an episode’s Storage copies to queue an encrypted copy to another bucket or make the destination primary. Completed copies provide automatic playback fallback if one source fails. Copying is explicitly queued by the admin; new uploads are not automatically replicated. Adding subtitles or replacing media invalidates previous copies: queue fresh copies afterward. Migration preserves the old source as a backup. Revoking the only usable token breaks playback. Replaced media and interrupted remote uploads can leave unused ciphertext in HF; preserve originals until you have verified replacements and perform storage cleanup deliberately.

The queue has a dedicated live detail page for each upload, including speeds, saved chunks, stage progress and recovery controls. See [upload recovery](docs/UPLOAD_RECOVERY.md) for restart behavior and its limits.

## Keeping your circle private

Registration requires a valid one-time invitation. Catalog APIs, purchases, watchlists and playback require login. Admin APIs verify the role server-side. Enable MFA in Account for your admin. Recovery codes are displayed once and stored as hashes.

The Docker defaults bind exposed ports to localhost and use development cookies for local HTTP. For friends on another machine, set `APP_ORIGIN` to the exact URL they will use. For an HTTPS deployment set the API's `NODE_ENV=production`, use HTTPS and secure cookies, and route everything through the web origin. Do not expose PostgreSQL or Redis publicly. The Docker web build uses `http://api:4000` and `http://gateway:4001` for internal proxying; native builds use `API_INTERNAL_URL` and `GATEWAY_INTERNAL_URL`. Set both before building.

Back up PostgreSQL, the HF objects, local artwork, and the master key separately. Losing the master key makes saved tokens and media keys unreadable. Do not regenerate it on an existing installation. Media encryption protects stored files; it is not intended to hide activity from a provider or replace having permission to share content.

Forgotten password: set `RESET_EMAIL` and `RESET_PASSWORD` in your local shell, then run `npx tsx scripts/reset-password.ts`. This changes the password and revokes sessions; it does not bypass MFA. Keep recovery codes.

## Updating an existing installation

Stop the running app processes, preserve your `.env`, and back up the database and master key. Run `npm run db:generate` and `npm run db:push` to apply the storage-copy schema additions, then restart with `npm run dev`. Read any Prisma migration warning before accepting it; do not use `--accept-data-loss`. For a compiled installation, run `npm run build` and restart the web, API, gateway and worker. Docker users can rebuild with the compose command above. Refresh the browser after restarting.

If storage setup fails, the API and gateway both need the Python environment from `requirements.txt`. A native install needs `PYTHON_BIN` pointing to that interpreter; Docker includes it. Token errors appear in the admin dialog. The HF account must have bucket creation/write permission and available storage allowance. The adapter follows the [official HF bucket API](https://huggingface.co/docs/huggingface_hub/en/guides/buckets).

## Development handoff

Run `npm run typecheck` for static TypeScript checks. `npm run build` compiles Next.js and the NestJS/worker source. These commands are not functional tests.

The requested manual test cases are in `MANUAL_TEST_CASES.txt`. No automated tests or browser tests were written or executed. HF uploads, Razorpay transactions, database migrations and playback still need your configured environment and manual testing. Python, FFmpeg and Docker were not installed globally by the agent.

The artwork is original AI-generated imagery; fictional titles are demonstration content, not supplied movies. Image-generation prompts and asset paths are recorded in `docs/ARTWORK.md`.

## Layout

```
app/                   Next.js routes and visual design
components/            Viewing UI, player and admin studio
server/                NestJS controllers, encryption, worker and HF adapter
prisma/                PostgreSQL schema and initial admin seed
scripts/               Local setup, HF SDK adapter and password recovery
public/art/            Original artwork
MANUAL_TEST_CASES.txt   Your plain-text testing checklist
```
