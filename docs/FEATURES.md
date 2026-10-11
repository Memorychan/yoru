# Feature review

The following workflows are implemented in the source. Compilation is checked; live integrations and user workflows need the manual checks in `MANUAL_TEST_CASES.txt`.

| Requirement                                      | Implementation                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anime, anime movies, cartoons and cartoon movies | Category and movie/series formats, seasons, ordered episodes, search and filters                                                                       |
| Private use with friends                         | Invitation-only registration, sessions, disabled-member controls and optional authenticator MFA                                                        |
| Admin-only publishing and uploads                | Server role guards, title/episode editor, artwork upload, draft previews and publish checks                                                            |
| HF public storage, encrypted files               | AES-256-GCM segments and subtitles, randomized `.bin` names, server-held manifests and wrapped keys                                                    |
| Set up buckets in admin                          | Token-based account discovery, organization selection, create public/private bucket, connect existing, create additional buckets and change visibility |
| Multiple storage accounts                        | Independent connections, token rotation, health checks and upload pausing                                                                              |
| Storage resilience                               | Admin-queued encrypted copies and migrations; gateway fallback to completed copies                                                                     |
| Movie or whole-series pricing                    | Free, purchase or rental per title; versioned prices and rental expiry                                                                                 |
| Razorpay                                         | Server-created orders, checkout, signature and capture verification, signed webhooks, entitlement reconciliation and full refund controls              |
| Curated carousels                                | Featured home title, horizontal shelves, admin collections with reorderable titles and visibility controls                                             |
| Polished viewing interface                       | Responsive dark interface, original fictional artwork, discovery, library and account pages                                                            |
| Playback                                         | Adaptive HLS, source audio selection, WebVTT subtitles, skip intro, resume progress, watchlist, data saver and optional next-episode autoplay          |
| Upload management                                | Checksummed resumable chunks, per-file live detail pages, speed/ETA, persistent processing checkpoints, automatic retries and manual recovery         |
| Member preferences                               | Device-local spoiler protection, next-episode autoplay, audio/subtitle preferences and data saver                                                      |
| Operations                                       | Separate API/gateway/worker, Docker configuration, native Windows setup, audit records and documented backup/password recovery                         |

## Practical boundaries

- HF tokens and Razorpay secrets must be supplied by the admin. Provider permissions, storage allowances and payment availability still apply.
- Public HF objects are encrypted, but an authorized viewer can record playback. This is not DRM.
- Storage copies are queued explicitly. Media replacement or subtitle changes require new copies. Remote cleanup is deliberately manual.
- Browser autoplay policies can require pressing Play on the next episode. Native HLS browsers use their own quality/audio controls.
- This is a private web application. Native mobile/TV apps, offline DRM downloads, subscriptions, coupons and provider-independent storage are not included.
- No functional, integration or browser tests were run. The text checklist is provided for the owner to execute.

## Custom cinema player

The player provides play/pause, a buffered timeline, ten-second skips, volume/mute, speed, quality/data saver, audio language, captions and caption size, local SRT/VTT loading, admin encrypted caption publishing, fullscreen, picture-in-picture when supported, fit, repeat and next episode. Keyboard shortcuts apply while the player has focus.

Large unbuffered seeks cancel browser downloads at the previous position and restart HLS loading at the destination. The HF download queue prioritizes requested playback over prefetching and reserves two of its four workers for foreground requests. This reduces avoidable waiting; initial uncached HF response time still depends on the connection between the application server and storage. Native HLS audio selection depends on the browser exposing its audio-track API.
