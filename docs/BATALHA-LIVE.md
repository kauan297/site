# Batalha da LIVE — browser bridge

The existing service now mounts an isolated `/api/battle` router. It uses the existing server-side `EULER_API_KEY` and does not modify Roblox, payments, licensing or database data. No new service or paid resource was created.

Only the SHA-256 hash of a random 256-bit game access token is committed in `battle-access.json`. The owner opens a private game access link whose fragment carries that scoped token. The game removes the fragment after storing the token locally, and sends it in the Authorization header. The upstream provider key is never sent to the browser, returned in status, or logged. Rotate game access by replacing its hash and issuing a new owner link.

All bridge endpoints require the game token. CORS allows only the owner-private game origin. `/status` reports readiness and connection state; `/events` is an authenticated SSE stream; `/start` starts one upstream for the chosen TikTok account after a screen is attached; `/stop` closes it. A maximum of three receiving screens and five starts per IP per five minutes prevent accidental duplicate connections. The upstream stops after 90 seconds without a receiving screen.

The relay uses JSON v2 Euler WebSocket messages. It accepts only exact Rose/Rosa and White Rose/Rosa branca names, counts a completed streak once, deduplicates provider message/group IDs, and forwards sender handle, display name and avatar URL. It does not require Roblox nickname comments. Reconnects use backoff. Offline/auth/connection-limit states are explicit; a WebSocket transport opening alone is not considered a confirmed live.

SSE events have an epoch and sequence. Up to 300 events from the last 30 seconds can be replayed after a short receiving-screen interruption; longer gaps raise a notice. A new game page starts from the current cursor and does not apply old gifts. State is in memory, and an instance restart requires the browser to reconnect the upstream.

Validation performed before publication: Node syntax checks; actual HTTP/SSE router plus a fake Euler upstream and the game's live client/core. Tests cover auth, CORS, no upstream without a screen, real-event shapes, both rose targets, combo quantity, duplicate suppression, sender name/photo, ignored gifts/comments, connection confirmation, interrupted-transport replay exactly once, explicit offline and cleanup. This is not a paid-gift test against the owner's real live. That final test requires the owner to start the live and receive each rose.

Runtime dependencies remain Express and ws already present in the service. Backend integration fixtures were run in the task workspace; frontend fullscreen, game, controller and music checks remain in the Site source.
