# ZY04 Implementation State

## Repository

- Branch: `main`
- Main dashboard merge commit: `2ef02af`
- Same-origin dashboard serving commit: `4750fd5`
- Phase 1 commit: `fa2e00d`
- Phase 2 commit: `cc52296`
- R2 storage phase commit: `dc813ba`
- Phase 3 commit: `22aa961`
- Phase 4 commit: `be4d87a`
- Phase 5 commit: `780cebe`
- Phase 6 commit: `0da3c08`
- Phase 7 commit: `53175a1`
- Phase 8 commit: `d753557`
- Phase 9 commit: `3b118d3`
- Phase 10 commit: `114a24e`
- Phase 11 commit: `7d6a9eb`
- Phase 12 verification commit: `3af83bc`

## Implemented endpoints

- `POST /sca/recordupload`
- `GET /sca/device/cloud_time`
- `POST /sca/device/config`
- `POST /sca/device/config_status`
- `POST /sca/device/reportinfo`
- `POST /sca/device/debug_log`
- `POST /ota/v1/fetch_new_firmware`
- `POST /api/admin/auth/login`
- `POST /api/admin/auth/logout`
- `GET /api/admin/auth/me`
- `GET /api/admin/activity/stream`
- `GET /api/admin/overview`
- `GET /api/admin/devices`
- `GET /api/admin/devices/:sn`
- `GET /api/admin/devices/:sn/activity`
- `GET /api/admin/alerts`
- `GET /api/admin/audit-logs`
- `GET /api/admin/recordings`
- `GET /api/admin/logs/status`
- `GET /api/admin/logs/report`
- `GET /api/admin/logs/debug`
- `GET /api/admin/firmware`
- `POST /api/admin/configs`
- `POST /api/admin/firmware`
- `PUT /api/admin/firmware/:id`
- `POST /api/admin/firmware/:id/disable`
- `GET /api/admin/recordings/:id/wav`
- `GET /api/admin/recordings/:id/original`
- `POST /api/admin/recordings/:id/retry`
- `GET /api/admin/logs/debug/:id/download`
- `POST /api/admin/logs/debug/:id/delete`
- `GET /api/recordings`
- `GET /api/recordings/:id`
- `GET /api/recordings/:id/audio`
- `GET /health`

Firmware binary upload remains intentionally unimplemented; URL-based firmware and the requested Phase 11 management actions are implemented.

## Important files

- Upload contract and validation: `backend/src/routes/recordUpload.ts`
- Recording schema/indexes: `backend/src/models/Recording.ts`
- Idempotency/session processing: `backend/src/services/recordingService.ts`
- Strict decode/output publication: `backend/src/services/audioService.ts`
- Decimal uint32 parsing: `backend/src/utils/serial.ts`
- Safe recording reads/audio streaming: `backend/src/routes/recordings.ts`
- Badge Time Sync: `backend/src/routes/deviceTime.ts`
- Badge configuration fetch: `backend/src/routes/deviceConfig.ts`
- Device identity/last-seen model: `backend/src/models/Device.ts`
- Device configuration delivery model: `backend/src/models/DeviceConfig.ts`
- Report/status ingestion: `backend/src/routes/deviceReport.ts`
- Report parsing, health updates, and alert transitions: `backend/src/services/deviceReportService.ts`
- Raw/parsed device logs: `backend/src/models/DeviceLog.ts`
- Preserved device alert history: `backend/src/models/DeviceAlert.ts`
- Debug-log multipart ingestion: `backend/src/routes/debugLog.ts`
- Debug-log storage/metadata coordination: `backend/src/services/debugLogService.ts`
- Debug-log metadata: `backend/src/models/DebugLog.ts`
- OTA firmware fetch: `backend/src/routes/ota.ts`
- OTA validation, version comparison, and selection: `backend/src/services/otaService.ts`
- URL-based firmware catalog: `backend/src/models/Firmware.ts`
- Admin authentication routes: `backend/src/routes/adminAuth.ts`
- Password/session authentication and reusable middleware: `backend/src/services/adminAuthService.ts`
- Append-only audit helper: `backend/src/services/auditService.ts`
- Single admin identity: `backend/src/models/Admin.ts`
- Revocable admin sessions: `backend/src/models/AdminSession.ts`
- Append-only audit history: `backend/src/models/AuditLog.ts`
- Supplier API activity model/30-day retention: `backend/src/models/ApiActivity.ts`
- Sanitized activity tracking and live event publication: `backend/src/services/apiActivityService.ts`
- Authenticated dashboard REST/SSE routes: `backend/src/routes/adminDashboard.ts`
- Frontend admin shell, protected routing, overview/devices/activity/alerts pages: `frontend/src/App.tsx`
- Credentialed admin API client and SSE URL: `frontend/src/api.ts`
- Frontend admin API response contracts: `frontend/src/types.ts`
- Responsive admin dashboard styling: `frontend/src/styles.css`
- Admin management validation/creation service: `backend/src/services/adminManagementService.ts`
- Authenticated and audited admin management routes: `backend/src/routes/adminManagement.ts`
- Recording storage abstraction and R2 configuration: `backend/src/services/storageService.ts`
- Route registration, dashboard static serving, and guarded SPA fallback: `backend/src/app.ts`

## Model and indexes

- Model: `Recording` / collection: `recordings`
- R2 references: `original_object_key` and `wav_object_key`; local path fields remain nullable for development/legacy fallback.
- `Device` has unique `sn` plus `product`, `model`, `version`, and `last_seen_at`.
- `DeviceConfig` queues values by device/model with `PENDING`, `DELIVERED`, `SUCCESS`, or `FAILED` status, delivery attempts, and timestamps.
- `DeviceConfig` acknowledgement metadata: bounded raw `acknowledgement_status`, `acknowledged_at`, and `completed_at`.
- Device configuration queue index: `{ device_sn: 1, device_model: 1, status: 1, created_at: 1 }`; session identity is unique per device.
- `DeviceLog` stores bounded raw JSON text plus normalized fields and has a device timeline index.
- `DeviceAlert` keeps `ACTIVE`/`RESOLVED` incidents; a partial unique index allows one active alert per device/type while retaining resolved history.
- `DebugLog` stores `sn`, timestamp, safe filename, size, R2/local reference, storage mode, upload time, and optional deletion time; `{ sn, ts, file_name }` is unique.
- `Firmware` stores model/type/version, HTTP(S) URL, MD5, force/default update type, enabled state, and timestamps; model/type/version is unique.
- `Admin` enforces one `PRIMARY` administrator and stores only a salted scrypt password hash.
- `AdminSession` stores only SHA-256 token hashes, expires after 24 hours via TTL, and supports revocation.
- `AuditLog` records actor, action, target, sanitized metadata, request context, and creation time; application/model update and delete operations are rejected.
- `ApiActivity` stores sanitized supplier request/response activity and has a 30-day TTL index on `created_at` plus device timeline indexes.
- Existing unique `record_id` index remains.
- New unique logical-slice index: `{ device_sn: 1, session_id: 1, serial: 1 }`.
- The new index is partial on `slice_number` so legacy documents remain readable and existing rows require no destructive migration.

## Recording states

`RECEIVED`, `WAITING_SLICES`, `PROCESSING`, `PENDING_LZ4_CONFIRMATION`, `READY`, `FAILED`.

## Verified behaviour

- Required multipart metadata and exactly one `record_file` are enforced.
- `serial` is a strict decimal uint32; slice zero and invalid/out-of-range values are rejected.
- Sessions and all related queries use `device_sn + session_id`.
- Retries return the existing `record_id` and do not overwrite a valid slice.
- Only complete `1..finalSliceNumber` sequences can begin processing.
- Missing slices wait; a single-process guard plus atomic final-record transition prevents duplicate processing.
- Decode failures cannot create silent WAVs or become `READY`.
- Public APIs do not return filesystem paths, and only an existing safe WAV can be streamed.
- Backend and frontend production builds pass.
- Badge Time Sync returns HTTP 200 with `code: 0`, a current 13-digit millisecond timestamp, JSON content type, and explicit content length without querying MongoDB.
- Recording slices and decoded WAVs use Cloudflare R2 when the complete R2 environment is present; R2 records store object keys and null local paths.
- Playback and processing prefer object keys and otherwise support safe legacy/development files under `UPLOAD_DIR`.
- R2 writes and local writes are non-overwriting, and a stored WAV is verified before a session can become `READY`.
- Missing R2 configuration falls back locally only in development/test; partial/invalid configuration and other environments are rejected.
- Configuration fetch validates `product`, `sn`, and `version`, upserts device metadata/last-seen, and atomically returns the oldest matching `PENDING` or `DELIVERED` config.
- Fetch marks the config `DELIVERED`, increments attempts, protects reserved response keys, and keeps it eligible for redelivery until a later acknowledgement marks success.
- No matching configuration returns exactly `{ "code": 1 }` with HTTP 200.
- Configuration acknowledgement matches `device_sn + session_id`, supports numeric/string session identifiers, and updates device last-seen for every valid request.
- `success` transitions a matching configuration to `SUCCESS`; other bounded statuses transition an eligible configuration to `FAILED` while preserving the raw acknowledgement.
- Duplicate acknowledgements are idempotent, repeated failures do not rewrite completion timestamps, and a stale failure cannot downgrade `SUCCESS`.
- Missing acknowledgement sessions return non-zero `code: 1` without exposing internal details.
- Report info validates required `common` identity/version fields and classifies payloads by the presence of `dev_info.status`.
- Status logs update device power, operating state, storage, Wi-Fi, local file count, debug/report counts, hub SN, firmware versions, and last-seen time.
- Report logs parse upload outcomes; all accepted logs retain bounded raw JSON text without storing supplier keys as MongoDB paths.
- Low-battery (`power <= 20`), storage (`free <= 10%`), and upload-failure alerts activate without duplicating active incidents and auto-resolve on observed recovery while preserving history.
- Debug-log upload requires `sn`, a 13-digit `ts`, and exactly one non-empty `log_file`; deprecated `create_time` is accepted and ignored.
- Debug files use `debug-logs/{sn}/{ts}-{safe_file_name}` through the shared R2/local storage policy, and valid uploads upsert device last-seen.
- Local debug-log objects are explicitly excluded from the existing public static-upload route.
- OTA fetch validates and echoes current firmware, ignores unknown types during lookup, and returns at most one eligible enabled URL package per supported requested type.
- Forced packages may downgrade or replace equal versions; default packages must compare newer. Missing matches return an empty `latest_firmware` array.
- Valid OTA requests upsert device identity and update model/last-seen without accessing firmware file storage.
- Admin login uses the environment-provisioned single administrator, an HttpOnly/SameSite signed opaque cookie, and a revocable 24-hour server-side session.
- Login success/failure and logout are audited; `requireAdmin` and `writeAuditLog` are exported for future admin APIs.
- Missing, invalid, expired, or revoked sessions are rejected by admin middleware; logout revokes the session and clears the cookie.
- Production startup rejects missing/incomplete `ADMIN_EMAIL`, `ADMIN_PASSWORD`, or `SESSION_SECRET`; values are never logged or committed.
- Supplier `/sca/*` and OTA endpoints remain outside admin middleware.
- The seven supplier endpoints are activity-tracked without requiring admin authentication; HTTP status, JSON response code, combined success, device SN, sanitized bodies, duration, and creation time are retained.
- Recursive activity sanitization redacts credential-like keys, bounds payload structure/text, and replaces buffers with metadata-only omission markers.
- Recording/debug multipart activity contains text fields and file name/type/size metadata but never file bytes.
- All Phase 9 dashboard REST endpoints and the SSE stream use `requireAdmin`; the intentionally public login route remains the only unauthenticated admin entry point.
- Dashboard list endpoints use bounded pagination and explicit field selection; recording/debug responses omit local filesystem paths and storage object paths.
- The authenticated SSE endpoint sends ready, heartbeat, and newly persisted activity events without polling MongoDB.
- The frontend checks the 24-hour admin session before rendering protected content, redirects unauthenticated routes to login, and performs credentialed login/logout requests.
- The responsive dashboard prioritizes active alerts, derives active/offline fleet state from a five-minute last-seen window, and provides overview, device, device-detail, live activity, and alert-history views.
- Device details separate activity, recordings, status reports, general reports, and debug-log metadata into read-only tabs.
- Live API activity provides all seven supplier endpoint tabs, connection state, bounded exponential reconnects, and a full sanitized request/response detail modal.
- Frontend admin views consume only path-free API contract fields; no physical-delete or firmware-binary-upload action is exposed.
- Admin configuration creation accepts one or multiple known devices, combines common/advanced settings, and rejects every key outside the 19 documented supplier configuration keys.
- Configuration audits contain device targets and setting names only; sensitive setting values are not copied into audit metadata.
- URL firmware can be created for one or multiple models, updated, enabled, or disabled; forced delivery and version downgrade require `confirm_force_or_downgrade: true`.
- Admin recording routes stream available WAV/original objects through R2/local storage without returning object keys or paths; retry accepts only complete uncompressed sessions without active processing or a valid existing WAV.
- Admin debug-log download streams storage content, while deletion only sets `deleted_at` and preserves the underlying object for recovery.
- Every Phase 11 mutation is authenticated and writes its audit intent before changing state; administrative downloads are audited as well.
- Supplier endpoint contracts and authentication boundaries are unchanged.
- Activity sanitization additionally redacts documented S3 configuration, extra headers, and proxy configuration so config delivery cannot retain embedded credentials.
- The dashboard now includes confirmed multi-device configuration and model-wide URL firmware forms, firmware edit/enable/disable controls, safe recording actions, and confirmed debug-log soft deletion with audit-friendly feedback.
- The global `#/recordings` dashboard loads every page of `/api/admin/recordings`, so direct recording rows remain visible even when no matching Device document exists.
- Global recordings are grouped by `device_sn + session_id` where possible, with isolated fallback rows for legacy records missing grouping fields.
- Recording availability is exposed only as `original_available` and `wav_available` booleans; storage object keys and filesystem paths remain excluded.
- The global view shows safe WAV/original downloads only when referenced storage is available and offers retry only for complete, failed, uncompressed sessions.
- The backend production build installs/builds the sibling Vite project, and Fastify serves only `frontend/dist` as public static content.
- `/` and non-API HTML routes fall back to the dashboard `index.html`; `/api/*`, `/sca/*`, `/ota/*`, `/health`, and `/uploads/*` never use the SPA fallback.
- The legacy public upload-directory mount is removed. Recording and debug content remains available only through the existing controlled streaming/download APIs.
- Serving the dashboard and admin APIs from one HTTPS origin makes the existing strict, secure admin session cookie suitable for the Render deployment.
- Admin-auth startup diagnostics report only environment presence flags and normalized/string lengths. Failed-login diagnostics report only submitted/configured lengths and the email-match boolean.
- Failed-login audit entries no longer retain the submitted email or use it as a target identifier; their metadata is limited to the same safe mismatch diagnostics.

## Phase 2 changed files

- `backend/src/routes/deviceTime.ts`
- `backend/src/app.ts`
- `ZY04-IMPLEMENTATION-STATE.md`

## R2 storage phase changed files

- `backend/src/services/storageService.ts`
- `backend/src/services/recordingService.ts`
- `backend/src/services/audioService.ts`
- `backend/src/routes/recordings.ts`
- `backend/src/models/Recording.ts`
- `backend/package.json`
- `backend/package-lock.json`
- `backend/.env.example`
- `ZY04-IMPLEMENTATION-STATE.md`

Backend and frontend production builds pass. Manual checks pass for transient local save/read/delete, complete R2 configuration, rejection of partial R2 configuration, rejection of production local fallback, and both required recording key formats. No production storage or database was contacted.

## Phase 3 changed files

- `backend/src/models/Device.ts`
- `backend/src/models/DeviceConfig.ts`
- `backend/src/routes/deviceConfig.ts`
- `backend/src/app.ts`
- `ZY04-IMPLEMENTATION-STATE.md`

Backend and frontend production builds pass. In-memory route checks pass for device upsert, oldest-first selection, `PENDING`/`DELIVERED` eligibility, attempt increments, flattened values, reserved-key protection, exact no-config response, and invalid-input rejection. No MongoDB connection was made.

## Phase 4 changed files

- `backend/src/models/DeviceConfig.ts`
- `backend/src/routes/deviceConfig.ts`
- `ZY04-IMPLEMENTATION-STATE.md`

Focused in-memory checks pass for success, failure, missing session, duplicate success/failure, stale failure after success, numeric/string session matching, device last-seen updates, and invalid input. No MongoDB connection was made.

## Phase 5 changed files

- `backend/src/models/Device.ts`
- `backend/src/models/DeviceLog.ts`
- `backend/src/models/DeviceAlert.ts`
- `backend/src/services/deviceReportService.ts`
- `backend/src/routes/deviceReport.ts`
- `backend/src/app.ts`
- `ZY04-IMPLEMENTATION-STATE.md`

Backend and frontend production builds pass. In-memory checks pass for status/report acceptance, parsed health, bounded raw storage, upload-failure detection, threshold activation and recovery for battery/storage, upload recovery, route registration, and invalid input. No MongoDB connection was made.

## Phase 6 changed files

- `backend/src/services/storageService.ts`
- `backend/src/models/DebugLog.ts`
- `backend/src/services/debugLogService.ts`
- `backend/src/routes/debugLog.ts`
- `backend/src/app.ts`
- `ZY04-IMPLEMENTATION-STATE.md`

Backend and frontend production builds pass. Multipart checks pass for valid upload, missing `sn`/`ts`/file, duplicate files, ignored deprecated `create_time`, device last-seen, metadata, exact key format, and blocked static access. Transient local files/directories were removed; no MongoDB or R2 connection was made.

## Phase 7 changed files

- `backend/src/models/Firmware.ts`
- `backend/src/services/otaService.ts`
- `backend/src/routes/ota.ts`
- `backend/src/app.ts`
- `ZY04-IMPLEMENTATION-STATE.md`

Backend and frontend production builds pass. In-memory checks pass for empty results, matching upgrades, disabled packages, unknown types, current-firmware echo, forced downgrade eligibility, dotted version comparison, device last-seen, and invalid input. No MongoDB connection was made.

## Phase 8 changed files

- `backend/src/models/Admin.ts`
- `backend/src/models/AdminSession.ts`
- `backend/src/models/AuditLog.ts`
- `backend/src/services/adminAuthService.ts`
- `backend/src/services/auditService.ts`
- `backend/src/routes/adminAuth.ts`
- `backend/src/app.ts`
- `backend/.env.example`
- `backend/package.json`
- `backend/package-lock.json`
- `ZY04-IMPLEMENTATION-STATE.md`

Backend and frontend production builds pass. Cryptographic and in-memory HTTP checks pass for password hashing, login success/failure, 24-hour signed sessions, valid/invalid/missing `me`, logout revocation/cookie clearing, login/logout/future audit events, append-only guards, production configuration failure, and unprotected supplier endpoints. No MongoDB connection was made.

## Phase 9 changed files

- `backend/src/models/ApiActivity.ts`
- `backend/src/services/apiActivityService.ts`
- `backend/src/routes/adminDashboard.ts`
- `backend/src/routes/debugLog.ts`
- `backend/src/routes/recordUpload.ts`
- `backend/src/app.ts`
- `ZY04-IMPLEMENTATION-STATE.md`

In-memory HTTP checks pass for authentication on every Phase 9 admin route, supplier routes remaining public, success/failure capture, response-code semantics, recursively sanitized request/response bodies, multipart binary omission, live SSE delivery, overview counts, and the exact 30-day TTL. Backend and frontend production builds pass. No MongoDB connection was made.

## Phase 10 changed files

- `frontend/src/App.tsx`
- `frontend/src/api.ts`
- `frontend/src/types.ts`
- `frontend/src/styles.css`
- `ZY04-IMPLEMENTATION-STATE.md`

Frontend production build passes. Isolated API checks pass for credentialed login, session verification, logout, 401 handling, protected/login route redirects, and bounded SSE reconnect backoff. Static contract checks confirm empty states for devices, activity, recordings, status/report/debug logs, and active/resolved alerts, with no storage or filesystem path fields used by the frontend. Backend production build passes. No production database was contacted.

## Phase 11 changed files

- `backend/src/services/adminManagementService.ts`
- `backend/src/routes/adminManagement.ts`
- `backend/src/routes/adminDashboard.ts`
- `backend/src/services/apiActivityService.ts`
- `backend/src/app.ts`
- `frontend/src/App.tsx`
- `frontend/src/api.ts`
- `frontend/src/types.ts`
- `frontend/src/styles.css`
- `ZY04-IMPLEMENTATION-STATE.md`

Isolated backend checks pass for authentication on all new routes, unchanged public supplier access, single/multiple config creation, invalid config-key rejection, firmware create/list/update/disable, explicit force/downgrade confirmation, path-free recording/debug downloads, safe recording retry, debug soft delete, sensitive config redaction, and mutation/download audit coverage. Isolated frontend checks pass for credentialed management requests, download triggers, and downgrade detection. Backend and frontend production builds pass. No MongoDB, R2, production file, deployment, or merge operation was performed; temporary verification files were removed.

## Global recordings dashboard changed files

- `backend/src/routes/adminDashboard.ts`
- `frontend/src/App.tsx`
- `frontend/src/api.ts`
- `frontend/src/types.ts`
- `ZY04-IMPLEMENTATION-STATE.md`

Backend and frontend production builds pass. Static and type checks confirm the authenticated global route, all-page loading, session grouping, orphan fallback, empty state, safe action eligibility, unchanged device-detail Recordings tab, and path-free availability fields. No database, object storage, deployment, or merge operation was performed.

## Same-origin dashboard serving changed files

- `backend/package.json`
- `backend/src/app.ts`
- `ZY04-IMPLEMENTATION-STATE.md`

The Render-style backend build and standalone frontend build pass. A compiled backend started on an alternate local port returned dashboard HTML for `/` and a direct SPA route, returned healthy JSON from `/health`, rejected unauthenticated `/api/admin/auth/me` with HTTP 401, kept unknown API and `/uploads/*` requests out of the SPA fallback, and retained all seven supplier routes. No supplier contract, environment file, database record, or object-storage object was changed.

## Admin login mismatch diagnostics changed files

- `backend/src/services/adminAuthService.ts`
- `backend/src/routes/adminAuth.ts`
- `backend/src/server.ts`
- `ZY04-IMPLEMENTATION-STATE.md`

An isolated failure check confirms exactly five approved startup fields and five approved login-failure fields, with no raw email, password, or session-secret value in application or audit diagnostic payloads. Backend/frontend production builds pass; supplier APIs are unchanged.

## Known blockers and risks

- LZ4 framing is unconfirmed. Complete compressed sessions stop at `PENDING_LZ4_CONFIRMATION`; originals are preserved and no decompression/decoding is attempted.
- Supplier `opus-decoder-core` compatibility remains `UNVERIFIED`; the installed decoder is `opus-decoder`.
- The processing guard is reliable for the current single-process service, but there is no multi-instance lock or durable restart queue.
- Render local storage is ephemeral; production must provide R2 configuration. Local fallback remains development/legacy-only.
- Firmware binary upload/storage is pending; firmware management intentionally remains URL-based.
- Delivered configurations continue to be redelivered until a successful badge acknowledgement.
- No `render.yaml`, deployment workflow, or other repository-owned Render branch configuration exists. Feature-branch deployment safety cannot be established from this repository, so no deployment was attempted.
- The production admin session cookie remains `SameSite=Strict`; the dashboard must continue to be served from this backend origin unless a future cross-site cookie policy is explicitly reviewed.
- Actual Render environment values and service branch settings were not accessible during local verification and must be provisioned/confirmed without exposing their values.

## Phase 12 final verification (2026-09-14)

- Git: verified branch `feature/zy04-device-management-admin-dashboard`, initially clean, and exactly equal to `origin/feature/zy04-device-management-admin-dashboard` at `7d6a9ebc9f3d6db9e0840e9b17c4e3870e05ddb6` after an explicit fetch.
- Builds: backend `tsc` and frontend `tsc && vite build` pass.
- Supplier contract suite: all seven documented routes returned their documented success shapes over Fastify injection; cloud time also had JSON/content-length headers and a current 13-digit timestamp. Multipart checks used in-memory files and mocked persistence/storage only.
- Authentication boundary: all seven supplier routes succeeded without an admin session. The public login route remains the intentional exception under `/api/admin`; 23 session-protected admin data/action routes returned HTTP 401 with an invalid session.
- Activity: all seven successful supplier requests and one failed request were retained with correct success classification; multipart bodies stored metadata and `[binary omitted]`, never bytes.
- Storage/configuration: development/test local fallback passes; production without R2 and partial R2 configuration fail closed; complete syntactically valid R2 configuration selects R2 without making a network request. Production admin-auth configuration also fails closed when incomplete.
- Health/alerts: pure checks cover low battery and storage threshold activation, both recovery observations, and recording-upload failure detection. `DeviceAlert` transitions preserve resolved history.
- Recording safety: complete LZ4 input resolves to `PENDING_LZ4_CONFIRMATION`; no compressed decode was attempted. Complete uncompressed and missing-slice decisions resolve to `READY_TO_PROCESS` and `WAITING_SLICES`, respectively.
- Data exposure/audit: frontend contracts contain no storage/path fields; recording/debug paths and object keys are used only internally for streams. Admin management mutations/downloads call the audit helper, and `AuditLog` remains append-only.
- Retention: `ApiActivity.created_at` retains its exact 30-day TTL index.
- Secret scan: tracked files contain no non-placeholder private keys, common cloud/source-control tokens, credential-bearing MongoDB URI, or tracked runtime `.env` file. The documentation contains one explicitly placeholder-form MongoDB URI only.
- No MongoDB, R2, production filesystem, Render deployment, or merge was performed. The temporary verification script was removed.

### Render deployment checklist

Backend service:

- Set `NODE_ENV=production`.
- Set secret/database values: `MONGODB_URI` and `DATABASE_NAME`.
- Set all required R2 values together: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET`; set `R2_PUBLIC_BASE_URL` only when a public base URL is intentionally configured.
- Set admin values: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and a strong `SESSION_SECRET` (minimum 32 characters). Never place their values in build logs or committed files.
- Set `FRONTEND_URL` to the exact deployed frontend origin for credentialed CORS. Render supplies `PORT`; `HOST` defaults to `0.0.0.0`.
- Do not use `UPLOAD_DIR` as production persistence. Production must use R2.
- Suggested service commands with backend as root: build `npm ci && npm run build`; start `npm start`.

Frontend service:

- A separate frontend service is no longer required. Leave `VITE_API_URL` unset for same-origin requests (or set it to the exact same backend origin).
- The backend build runs the frontend install/build from `../frontend`, and Fastify serves the resulting `frontend/dist` directory.
- Keep `VITE_BACKEND_URL` limited to local Vite proxy development; it does not configure the production bundle.

Deployment gate:

- Confirm in Render which Git branch each service tracks and whether preview/feature-branch services exist. No repository evidence proves feature-branch deployment is safe.
- If services track only `main`, obtain explicit merge approval later; do not merge as part of Phase 12.
- Provision and validate environment values in Render without printing them, then run health, supplier contract, admin login/session/SSE, R2 upload/download, and rollback smoke tests against a non-production branch service first.

## Exact next phase

After the safe login diagnostics reach Render, make one failed login attempt and inspect `Admin login rejected`: email match plus submitted/configured lengths identify an env-input mismatch without revealing values. If all safe fields match but login remains rejected, the persisted `PRIMARY` admin identity/hash is stale and requires an explicitly authorized credential-rotation path. Supplier confirmation is still required for LZ4 framing and `opus-decoder-core` compatibility before enabling those recording paths.
