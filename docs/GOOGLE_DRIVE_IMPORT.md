# Private Google Drive imports

Google Drive importing runs on the application server (the HF Space when deployed), never through the admin's laptop. Videos download sequentially, verify chunks and available Google MD5 checksums, then enter the existing FFmpeg/encryption/HF pipeline. The user must have downloadable access; OAuth cannot bypass an owner's download restriction.

## Google Cloud setup

1. Open https://console.cloud.google.com/ and create/select a project called Yoru.
2. In APIs & Services > Library, enable Google Drive API.
3. Open Google Auth Platform. Set Branding app name to Yoru and your support/developer email. In Audience choose External, leave the app in Testing, and add the Google email that has access to the private folder as a Test user.
4. In Data Access add `https://www.googleapis.com/auth/drive.readonly`. This allows read-only access to files accessible to the authorized account; it is broader than the folder subsequently selected. It does not let Yoru modify or delete Google files.
5. In Clients, create an OAuth client with type Web application. Add the Authorized redirect URI exactly:
   `https://kishankrish19-nexus-tts-engine.hf.space/api/admin/drive/callback`
   For localhost development also add `http://localhost:3000/api/admin/drive/callback`.
6. Copy Client ID and Client Secret into HF Space Settings > Secrets, named exactly `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Keep `APP_ORIGIN` equal to the direct Space origin without a trailing slash. Never upload the downloaded credential JSON into the repository.
7. After deploying this feature, sign into Yoru as admin, open Google Drive in Admin studio, and click Connect Google Drive. Sign into the Google account added as a Test user and grant read-only Drive access. The return URL should show connected.
8. Create a draft Series title for anime seasons. Return to Google Drive, paste the private folder URL, and click Inspect folder. No videos are downloaded during inspection.
9. Review the files, total sizes, nested season paths, availability, episode names, seasons and numbers. Select desired videos, choose the draft title and enabled HF storage, then Approve imports. Repeated season/episode numbers and replacement of existing media are rejected.
10. Follow Import history or Upload queue for source download, processing and HF transfer. Publish only after every intended episode is READY.

OAuth test apps using Drive scopes normally receive refresh tokens that expire after seven days. Reconnect when needed. Public deployment with this restricted read-only scope can require Google verification; personal use/testing does not make the consent app verified. Do not publish the Google consent app merely to avoid reconnection without reviewing Google's requirements.

## Limits and recovery

- Preview includes up to 200 folders and 3000 files. Approval accepts up to 300 selected videos at once. Choose a smaller season folder for larger libraries.
- Season folders such as Season 2 or S02 and filenames such as S02E03 are recognized. Suggested numbering is editable and must be reviewed. Non-video files, shortcuts, absent sizes and blocked downloads are not eligible.
- The MAX_UPLOAD_GB per-file limit applies. The server checks for at least three times the source size in free space; actual encoding sizes vary. Processing is prioritized before the next import to reduce staging buildup. Existing completed source/checkpoint files may still occupy disk; a large series can exceed a free Space's capacity.
- Google quotas, download caps, network interruption and changed source files can prevent import. Three queue attempts use backoff; failed downloads have a Retry button. Downloaded acknowledged chunks are retained on durable local disk.
- On the same disk, downloads resume at flushed chunk boundaries. A Space's ephemeral disk loss requires downloading the source again. OAuth connection credentials and import records are included in encrypted database backups, but in-progress source files and rendition checkpoints are not. Missing rendering/processing data still needs the existing staging recovery workflow.
- Disconnect deletes Yoru's stored refresh token; revoke the app from your Google Account permissions if you also want to revoke Google's grant. A download already using a temporary access token can continue until cancelled.
- The current account is the account you selected on Google's consent screen. Use Reconnect to change it.

References: https://developers.google.com/identity/protocols/oauth2/web-server and https://developers.google.com/workspace/drive/api/guides/manage-downloads

For local development after this additive schema change, run `npm run db:generate` and `npm run db:push` before starting the app or creating new backups. Docker Space startup applies the schema automatically before restoring. The archive reader permits missing DriveConnection/DriveImport tables in older backups while retaining checks for every existing model.
