# ZY04 Implementation State

## Repository

- Branch: `feature/zy04-device-management-admin-dashboard`
- Phase 1 commit: `fa2e00d`
- Phase 2 commit: `cc52296`
- R2 storage phase commit: `dc813ba`
- Phase 3: the commit containing the device configuration fetch foundation

## Implemented endpoints

- `POST /sca/recordupload`
- `GET /sca/device/cloud_time`
- `POST /sca/device/config`
- `GET /api/recordings`
- `GET /api/recordings/:id`
- `GET /api/recordings/:id/audio`
- `GET /health`

No configuration creation/acknowledgement, OTA, log, authentication, or Admin Dashboard endpoints are implemented yet.

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
- Recording storage abstraction and R2 configuration: `backend/src/services/storageService.ts`
- Route registration: `backend/src/app.ts`

## Model and indexes

- Model: `Recording` / collection: `recordings`
- R2 references: `original_object_key` and `wav_object_key`; local path fields remain nullable for development/legacy fallback.
- `Device` has unique `sn` plus `product`, `model`, `version`, and `last_seen_at`.
- `DeviceConfig` queues values by device/model with `PENDING`, `DELIVERED`, `SUCCESS`, or `FAILED` status, delivery attempts, and timestamps.
- Device configuration queue index: `{ device_sn: 1, device_model: 1, status: 1, created_at: 1 }`; session identity is unique per device.
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

## Known blockers and risks

- LZ4 framing is unconfirmed. Complete compressed sessions stop at `PENDING_LZ4_CONFIRMATION`; originals are preserved and no decompression/decoding is attempted.
- Supplier `opus-decoder-core` compatibility remains `UNVERIFIED`; the installed decoder is `opus-decoder`.
- The processing guard is reliable for the current single-process service, but there is no multi-instance lock or durable restart queue.
- Render local storage is ephemeral; production must provide R2 configuration. Local fallback remains development/legacy-only.
- R2 support for debug logs and OTA firmware is pending and was intentionally not implemented in this phase.
- Configuration creation UI and `POST /sca/device/config_status` remain pending; delivered configurations intentionally continue to be redelivered.

## Exact next phase

Phase 4: implement Badge Configuration Acknowledgement (`POST /sca/device/config_status`) so `success` atomically removes a delivered configuration from fetch eligibility; do not add creation UI or unrelated APIs.
