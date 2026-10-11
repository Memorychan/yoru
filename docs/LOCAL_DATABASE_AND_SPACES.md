# Local database and encrypted HF recovery

The application uses PostgreSQL locally, not Supabase. Redis also runs locally. On Windows, `npm run dev` starts missing local services automatically; they remain running when the web/worker processes stop. All database files, source uploads, queue data, and media checkpoints are under `data/`. Preserve this directory and the existing MASTER_KEY. Do not run two media workers against the same staging folder.

The October 7 migration copied all 21 application records across all 20 model tables, verified each table's complete row contents inside a transaction, and only then changed `.env`. The source Supabase data was not deleted. An AES-256-GCM encrypted database archive and encrypted pre-migration `.env` are in `data/backups/`. Queue jobs are rebuilt from durable upload records. Historical Redis cache/rate-limit keys were not copied.

## Backups

`npm run db:backup` snapshots all Prisma application tables consistently (uploaded artwork files are not included). It encrypts the complete archive with AES-256-GCM under MASTER_KEY, then uploads `database-latest.bin` to BACKUP_HF_BUCKET. HF tokens are passed to the Python adapter over stdin, never command-line arguments. The private backup bucket is separate from media storage. `npm run dev` schedules snapshots every BACKUP_INTERVAL_SECONDS (default 900). Look for the timestamped successful-backup log.

Keep MASTER_KEY somewhere safe outside the machine. Losing it makes both database backups and existing media unreadable. Set BACKUP_HF_TOKEN to a write-enabled token for the backup bucket. The provision command `node scripts/hf-backup.cjs provision` can create a private bucket using an already-connected admin HF account; this installation has already been provisioned.

On native Windows, the backup scheduler rereads BACKUP_HF_TOKEN and BACKUP_HF_BUCKET from `.env` before each backup, so credential updates take effect without restarting it. Space secrets require a container restart. `node scripts/refresh-backup-token.cjs` can refresh an obsolete backup credential from an existing admin storage connection after verifying the matching HF account and backup bucket access; it retains an encrypted configuration backup.

`npm run db:restore` restores only into an empty application database and verifies row contents. It never merges over existing data. Startup on a Space fails if the configured backup cannot be downloaded or authenticated; it does not silently create a new empty library or replace the remote backup.

Backups are periodic, not synchronous replication. A sudden loss of the machine/Space disk can lose changes since the last successful backup; network failures can extend that window. Uploaded media already on HF remains there. Backups do NOT contain unfinished source videos or processing checkpoints. On this PC those persist in `data/uploads` and `data/processing`. To move an unfinished job, stop its worker and copy both folders plus matching database state securely. Otherwise cancel/re-upload that original on the new host. The Space marks missing source files for attention instead of endlessly retrying them.

Use only ONE active installation writing a backup bucket. Before moving from this PC to a Space, finish active uploads, stop the local app, run `npm run db:backup`, and leave the local backup scheduler stopped. Two installations writing the same latest-backup object could overwrite each other's state.

## Hugging Face Docker Space

The root README contains Docker Space metadata, and Dockerfile starts a single non-root container with PostgreSQL, Redis, API, media gateway, one worker, backups and Next.js on port 7860. The database and queue bind only to loopback. Do not upload `.env`, `data/`, `tools/`, or `node_modules/`.

In Space Settings, set these secrets using values from your local `.env`:

- MASTER_KEY: exactly the existing key.
- BACKUP_HF_TOKEN: token with access to the private backup bucket.
- BACKUP_HF_BUCKET: the configured backup bucket identifier.
- RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET if enabling payments.

Set APP_ORIGIN to the Space's direct `https://<space-subdomain>.hf.space` URL, RAZORPAY_KEY_ID if used, and optionally BACKUP_INTERVAL_SECONDS. Do not copy Windows PYTHON_BIN/FFMPEG_BIN/FFPROBE_BIN paths, DATABASE_URL, REDIS_URL, PORT or DATA_DIR to Space secrets: the container configures its local services and bundled tools. Configure Razorpay's webhook for the new URL. Open the direct Space URL for login; the app's frame protection intentionally prevents embedded cross-origin login.

Startup initializes the local schema and restores the encrypted HF snapshot before serving requests. Existing accounts, passwords, catalog, pricing, storage tokens and media keys come from that snapshot. Build/deployment still needs to be verified on your Space; it was not deployed or runtime-tested during development.

HF documents that default Space disk is ephemeral: https://huggingface.co/docs/hub/spaces-storage . This design restores the latest successful encrypted snapshot after disk loss. It cannot promise zero-loss recovery of in-progress video work on an ephemeral disk. Do not put PostgreSQL directly on an object-storage bucket mount without verified database filesystem semantics. For video processing that must survive every host reset, keep processing on durable local storage.

## Manual checks (not executed by the development agent)

1. Run npm run dev. Sign in with the existing admin; verify the four titles and existing storage connection remain.
2. Reopen the existing upload. Completed renditions and checkpointed ciphertext should be verified/reused, then HF transfer should begin.
3. Stop/restart the app during encryption on a disposable upload. Previously checkpointed segments should be reused; at most seven uncheckpointed new segments may be regenerated safely.
4. Run npm run db:backup. Confirm a success timestamp and an unreadable .bin object in the private backup bucket.
5. On a disposable empty local database, restore the backup and verify accounts, catalog and storage settings. Never use a populated production DB for this check.
6. On a Space, verify restore completes before the web server starts. A wrong key or inaccessible bucket must prevent startup without overwriting the remote backup.
7. Verify playback of READY media after Space restart. An unfinished upload whose local source was lost must show a clear missing-staging error.

Uploaded artwork must be copied separately from data/artwork when moving hosts. The database-only HF backup was successfully acknowledged on October 8, 2026 at 08:40 IST after refreshing an obsolete backup credential. Run a fresh backup before deployment.



Artwork uploads now persist as AES-256-GCM objects under artwork/ in BACKUP_HF_BUCKET before a URL is returned. Space disk is only a cache; missing images are fetched and decrypted from the bucket. Preserve MASTER_KEY, the backup bucket, and its artwork/ objects. Title URLs still need a successful database backup to survive disk loss. Old images removed before this update cannot be recovered from the previous database-only snapshots and must be uploaded again. The home hero rotates among Featured published titles (or all published titles if none are Featured), with previous/next controls and pause on hover/focus.
