# Cast to TV

Open Yoru's direct HTTPS Space URL in Chrome. Connect your device and a Google Cast-enabled TV (Chromecast, Google TV, or compatible Android TV) to the same Wi-Fi. Allow Chrome's local network permission if requested. Click Cast to TV in the player and choose your TV.

The TV downloads the HLS stream directly from Yoru's gateway. Audio and video use the original common timeline; this does not separately relay or mirror browser audio. The selected audio language is used as the receiver's initial default. The receiver controls adaptive quality. Actual synchronization and buffering depend on TV decoding and the network and should be checked on your device.

The player transfers the current position, pauses local playback after the TV accepts the stream, and exposes TV play/pause, 10-second seeking, timeline, volume and stop controls. Stop casting returns to the TV's last position. TV progress is saved every 15 seconds. Keep the player open to control and save progress; the TV can keep playing if the tab closes.

The receiver receives a random, expiring capability for one existing playback session, rather than your login cookie, HF token or encryption key. Each request validates the account, session expiration and viewing permission. Stop casting revokes the capability. Existing playback sessions expire after four hours. Ordinary authenticated playback remains unchanged.

Your Space must be publicly reachable for the TV to fetch media; Hugging Face's private-Space login wall cannot be passed by the default Cast receiver. Yoru's invitation/login and paid-access checks still protect content. Use APP_ORIGIN with the direct hf.space HTTPS origin. A localhost origin is inaccessible to a TV. Guest Wi-Fi, router client isolation, blocked local discovery and denied browser network permissions can prevent discovery.

This supports Google Cast receivers, not every smart TV, Miracast or AirPlay. Browser-local caption files and audio boost remain browser features and are not transferred. Google Cast is supplied by Google's sender SDK and Default Media Receiver; no custom receiver registration is required.

Manual checks are listed in MANUAL_TEST_CASES.txt. No physical receiver tests were run.

Discovery initializes once before the Cast click. The browser device chooser is requested directly from the click without reinitializing the SDK. Initialization failures and no-device states are shown explicitly. If Chrome's own Cast menu cannot find the TV either, check browser local-network permission, Google Cast support on the TV, VPN and router guest/client isolation settings; application code cannot override those restrictions.
