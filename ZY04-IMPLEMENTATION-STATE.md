# ZY04 Implementation State

## Repository

- Branch: `feature/zy04-device-management-admin-dashboard`
- Phase 1 commit: `fa2e00d`
- Phase 2 commit: the commit containing the Badge Time Sync changes

## Implemented endpoints

- `POST /sca/recordupload`
- `GET /sca/device/cloud_time`
- `GET /api/recordings`
- `GET /api/recordings/:id`
- `GET /api/recordings/:id/audio`
- `GET /health`

No configuration, OTA, log, authentication, or Admin Dashboard endpoints are implemented yet.

## Important files

- Upload contract and validation: `backend/src/routes/recordUpload.ts`
- Recording schema/indexes: `backend/src/models/Recording.ts`
- Idempotency/session processing: `backend/src/services/recordingService.ts`
- Strict decode/output publication: `backend/src/services/audioService.ts`
- Decimal uint32 parsing: `backend/src/utils/serial.ts`
- Safe recording reads/audio streaming: `backend/src/routes/recordings.ts`
- Badge Time Sync: `backend/src/routes/deviceTime.ts`
- Route registration: `backend/src/app.ts`

## Model and indexes

- Model: `Recording` / collection: `recordings`
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

## Phase 2 changed files

- `backend/src/routes/deviceTime.ts`
- `backend/src/app.ts`
- `ZY04-IMPLEMENTATION-STATE.md`

## Known blockers and risks

- LZ4 framing is unconfirmed. Complete compressed sessions stop at `PENDING_LZ4_CONFIRMATION`; originals are preserved and no decompression/decoding is attempted.
- Supplier `opus-decoder-core` compatibility remains `UNVERIFIED`; the installed decoder is `opus-decoder`.
- The processing guard is reliable for the current single-process service, but there is no multi-instance lock or durable restart queue.
- Render local storage is ephemeral. Original slices and WAV files can disappear after restart/redeploy while MongoDB metadata remains.
- Cloudflare R2 integration remains pending.

## Exact next phase

Phase 3: implement Badge Configuration Fetch (`POST /sca/device/config`) with the minimum `Device` and `DeviceConfig` models and no unrelated APIs.
