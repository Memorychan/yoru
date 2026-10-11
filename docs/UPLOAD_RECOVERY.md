# Upload monitoring and recovery

In Admin → Upload queue, use **View live details** on a file. The detail page refreshes durable server state every two seconds. It shows source bytes saved, confirmed chunk counts, current-stage progress, source transfer speed, HF batch throughput, errors, retry controls and the worker heartbeat. The source sender also reports bytes in flight separately from acknowledged bytes.

## Source upload

Before uploading, the browser calculates a SHA-256 checksum for every 8 MiB chunk, reading one chunk at a time. The server stores this manifest in PostgreSQL. Each received chunk must match its expected length, offset and checksum. The server writes it, syncs it to disk, and commits the new offset before acknowledging it. Re-sending an already acknowledged matching chunk is idempotent.

A lost response does not mean lost progress: the browser reads the saved offset and resumes there. An incomplete or unacknowledged chunk is resent. Internal navigation keeps the transfer alive in the browser tab. Pause stops the sender; saved data remains. On browser closure or full reload, reopen the queue details and select the same source file. Its content hashes must match, regardless of its filename. Browser security prevents silently reopening an arbitrary local file after a restart.

This resumes file chunks, not individual TCP packets. Source bytes are never silently skipped. The guarantee depends on preserving the database and the persistent `DATA_DIR` disk. Deleting the disk, corrupting stored data, or losing the master key cannot be repaired by network retry logic; integrity failures stop processing visibly.

## Background stages

1. Source verification: check all available original chunk checksums before encoding. Older uploads without a checksum manifest predate this protection; resuming a partially uploaded original attaches one after verifying the saved prefix.
2. Encoding: save completed audio/video renditions with checksums. An interrupted rendition is rebuilt in its own attempt directory. Completed renditions are verified and reused.
3. Encryption: retain the same wrapped asset key and recorded encrypted segments in a private local checkpoint. Completed ciphertext is reused after a restart.
4. HF transfer: upload small batches, persisting provider acknowledgements after each batch. Unknown outcomes are resent to the same object names with the same ciphertext. Already recorded batches are skipped.
5. Remote verification: download every encrypted object and check its SHA-256 and AES-GCM authentication. Only verified media becomes READY. Verification adds download traffic. A network/download failure preserves upload acknowledgements and retries verification. A checksum or authentication mismatch marks the affected batch for re-upload.
6. Completion: commit the asset and READY status together, then remove the local source and working files. Publication remains an admin action.

If the worker stops, processing stops. Restart it to recover queued/stalled jobs. A periodic recovery pass recreates missing queue jobs from the database; the Redis queue and staging volume should still be persistent. Run one media worker for this private installation. Automatic retries are bounded; after repeated failures, the details page exposes **Retry from checkpoints**. Checkpoints remain after failure.

## Installation update

The additive fields in `prisma/upload-checkpoints.sql` were applied to the configured Supabase database during this change. Do not rerun that one-time SQL there. Other installations should generate the Prisma client and apply the current schema through the normal update procedure. Restart the API, gateway and worker along with the web server using `npm run dev`.

The development agent did not run upload, browser, failure-injection or playback tests. Execute the REC cases in `MANUAL_TEST_CASES.txt` with a disposable video before relying on recovery for important originals.
