# ZY04 Implementation State

## Repository

- Branch: `feature/zy04-device-management-admin-dashboard`
- Phase 1 commit: `fa2e00d`
- Phase 2 commit: `cc52296`
- R2 storage phase commit: `dc813ba`
- Phase 3 commit: `22aa961`
- Phase 4 commit: `be4d87a`
- Phase 5 commit: `780cebe`
- Phase 6 commit: `0da3c08`
- Phase 7 commit: `53175a1`
- Phase 8 commit: `d753557`
- Phase 9: the commit containing admin dashboard backend APIs and live activity

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
- `GET /api/recordings`
- `GET /api/recordings/:id`
- `GET /api/recordings/:id/audio`
- `GET /health`

No configuration creation, firmware file upload, frontend dashboard UI, or admin mutation APIs are implemented yet.

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
- Recording storage abstraction and R2 configuration: `backend/src/services/storageService.ts`
- Route registration: `backend/src/app.ts`

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

## Known blockers and risks

- LZ4 framing is unconfirmed. Complete compressed sessions stop at `PENDING_LZ4_CONFIRMATION`; originals are preserved and no decompression/decoding is attempted.
- Supplier `opus-decoder-core` compatibility remains `UNVERIFIED`; the installed decoder is `opus-decoder`.
- The processing guard is reliable for the current single-process service, but there is no multi-instance lock or durable restart queue.
- Render local storage is ephemeral; production must provide R2 configuration. Local fallback remains development/legacy-only.
- Firmware file upload/storage is pending; Phase 7 intentionally supports URL catalog entries only.
- Configuration creation UI remains pending. Delivered configurations are redelivered until a successful acknowledgement.

## Exact next phase

Phase 10 scope awaits explicit instruction. Keep all future dashboard/data APIs behind `requireAdmin`, use `writeAuditLog` for admin mutations, and do not infer frontend UI, deployment, config creation, or firmware upload work.
