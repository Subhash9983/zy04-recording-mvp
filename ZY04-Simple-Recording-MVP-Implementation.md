# ZY04 Smart Badge Recording MVP

## Goal

Build a very simple web app to prove:

**ZY04 → Wi-Fi → `POST /sca/recordupload` → our backend → save recording → decode → dashboard → play**

This is only an MVP. Do not add unnecessary features.

## 1. Required Backend

Use the existing backend stack if already available. Otherwise use:

- Node.js
- Fastify
- TypeScript
- MongoDB + Mongoose
- `@fastify/multipart`
- Render for deployment

Required supplier endpoint:

```http
POST /sca/recordupload
Content-Type: multipart/form-data
```

Final URL:

```text
https://YOUR-RENDER-DOMAIN.onrender.com/sca/recordupload
```

## 2. Supplier Request Fields

Accept these fields exactly:

| Field | Type | Meaning |
|---|---|---|
| `sn` | string | Badge SN |
| `esp_version` | string | ESP version |
| `dsp_version` | string | DSP version |
| `file_name` | string | File name |
| `mac` | string | Wi-Fi MAC address |
| `session_id` | string | Recording session |
| `create_time` | string | 13-digit timestamp, slice creation time |
| `duration` | string | Slice duration in milliseconds |
| `audio_type` | string | OPUS |
| `channel` | string | STEREO |
| `sample_rate` | string | 16000 |
| `frame_size_ms` | string | 20 |
| `frame_rate` | string | 8 |
| `sig_type` | string | 2 |
| `compress` | string | `lz4` when compressed, otherwise omitted |
| `record_file` | file | Recording slice |
| `serial` | string | Recording slice sequence number |

Do not rename these fields.

## 3. Upload Endpoint Logic

When a request arrives:

1. Receive multipart/form-data.
2. Read all metadata.
3. Receive `record_file`.
4. Generate a unique `record_id`.
5. Save the original uploaded slice.
6. Save metadata.
7. Return success quickly.
8. Decode/process asynchronously.

The supplier requires the response within 30 seconds, so do not perform slow decoding before responding.

Successful response:

```json
{
  "code": 0,
  "data": {
    "record_id": "rec_01JABC123"
  }
}
```

## 4. Recording Slices

A recording can arrive as multiple slices.

Example:

```text
0x00000001
0x00000002
0x00010003
```

The low 16 bits represent the slice number. The high 16 bits contain marking/flag information. The end bit indicates the last slice. Sequence starts at 1.

Store every slice and use:

```text
session_id + serial
```

to identify and order slices.

Do not assume one upload request equals one complete recording.

## 5. Database

Use **MongoDB Atlas** for the MVP because you already have MongoDB Atlas available.

Use Mongoose for the backend model.

Create a simple `recordings` collection with documents like:

```json
{
  "_id": "MongoDB ObjectId",
  "record_id": "rec_01JABC123",
  "device_sn": "4S1006EC4284500053",
  "mac": "AA:BB:CC:DD:EE:FF",
  "session_id": "ABC123",
  "file_name": "record_001.opus",
  "serial": "1",
  "create_time": "1760000000000",
  "duration_ms": 32000,
  "audio_type": "OPUS",
  "channel": "STEREO",
  "sample_rate": 16000,
  "frame_size_ms": 20,
  "frame_rate": 8,
  "sig_type": "2",
  "compress": null,
  "original_file_path": "uploads/4S1006EC4284500053/ABC123/00000001.opus",
  "wav_file_path": "uploads/4S1006EC4284500053/ABC123/recording.wav",
  "status": "READY",
  "created_at": "2026-09-10T16:15:00.000Z"
}
```

Status:

```text
RECEIVED
PROCESSING
READY
FAILED
```

No users or device-management collections are required for this MVP.

Recommended indexes:

```text
{ session_id: 1, serial: 1 }
{ device_sn: 1, created_at: -1 }
{ record_id: 1 }
```

`record_id` should have a unique index.

## 6. File Storage

For initial testing:

```text
uploads/
  <device_sn>/
    <session_id>/
      <serial>.opus
```

Example:

```text
uploads/
  4S1006EC4284500053/
    ABC123/
      00000001.opus
      00000002.opus
      00010003.opus
```

Do not overwrite slices.

For Render production, use persistent/object storage as appropriate. Do not rely on an ephemeral filesystem for recordings that must survive redeploys.

## 6. Audio File Storage for Phase 1 Supplier Test

For the **first supplier API test only**, keep the implementation simple:

- Deploy the backend on **Render**.
- Save uploaded `.opus` files temporarily in the Render service's local `/uploads` directory.
- Save decoded `.wav` files in the same temporary storage.
- Save only recording metadata and file paths in **MongoDB Atlas**.
- Do **not** add S3, Cloudflare R2, or other object storage in Phase 1.

Example:

```text
/uploads/
  <device-sn>/
    <session-id>/
      00000001.opus
      00000002.opus
      00010003.opus
      recording.wav
```

MongoDB stores metadata such as:

```text
record_id
device_sn
session_id
serial
file_name
duration
create_time
status
original_file_path
wav_file_path
```

### Important Render Limitation

Render's local filesystem should be treated as **temporary storage**. Files can be lost after a restart, redeploy, or other service lifecycle event.

That is acceptable for Phase 1 because the goal is only to:

1. Deploy the API.
2. Pass the supplier's API test.
3. Point the ZY04 badge to the Render upload endpoint.
4. Confirm that the badge can upload successfully.
5. Confirm that the server receives and processes the recording.

After the supplier test passes, Phase 2 can replace `/uploads` with permanent object storage such as Cloudflare R2 or S3.

**Do not add permanent storage before the supplier API test passes unless it becomes necessary.**


## 7. Compression

If:

```text
compress = lz4
```

handle LZ4 decompression before decoding.

If `compress` is absent, do not assume compression.

Keep the original upload during this MVP for debugging.

## 8. Audio Decoding

The supplier states that ZY04 uploads **non-standard OPUS** files.

They must be decoded to WAV before normal playback.

Use the supplier-recommended:

```text
opus-decoder-core
```

Pipeline:

```text
ZY04 upload
→ optional LZ4 decompression
→ ZY04 non-standard OPUS
→ opus-decoder-core
→ WAV
→ save WAV
→ dashboard playback
```

Do not assume a browser can directly play the original ZY04 OPUS file.

## 9. Dashboard

Create one simple page:

**ZY04 Recordings**

Show:

| Device SN | Session | Time | Duration | Status | Action |
|---|---|---|---|---|---|
| 4S1006... | ABC123 | 10 Sep 2026 16:15 | 00:32 | READY | Play |
| 4S1006... | XYZ789 | 10 Sep 2026 16:20 | 00:18 | PROCESSING | Processing |

For READY recordings show:

```text
▶ Play
```

The player must use the decoded WAV.

No complex dashboard is required.

## 10. Our Dashboard APIs

These are our own APIs, separate from the supplier API:

```http
GET /api/recordings
GET /api/recordings/:recordId
GET /api/recordings/:recordId/audio
```

`GET /api/recordings` returns the recording list.

Example:

```json
{
  "data": [
    {
      "record_id": "rec_01JABC123",
      "device_sn": "4S1006EC4284500053",
      "session_id": "ABC123",
      "duration_ms": 32000,
      "status": "READY",
      "created_at": "2026-09-10T16:15:00Z"
    }
  ]
}
```

`GET /api/recordings/:recordId/audio` streams the decoded WAV for the player.

## 11. Complete Flow

```text
                 ZY04
                   |
                 Wi-Fi
                   |
                   v
        POST /sca/recordupload
                   |
                   v
              Our Backend
              /          \
             v            v
        Database       File Storage
                           |
                           v
                     OPUS Decoder
                           |
                           v
                          WAV
                           |
                           v
                      Dashboard
                           |
                           v
                         PLAY
```

## 12. Testing

### Test A: Local

Run:

```text
POST http://localhost:3000/sca/recordupload
```

Verify:

- multipart request accepted
- all fields received
- `record_file` received
- file saved
- metadata saved
- unique `record_id` generated
- correct response returned

### Test B: Render + Supplier Tester

Deploy to Render:

```text
https://zy04-test-api.onrender.com
```

Supplier tester:

```text
TEST DOMAIN:
zy04-test-api.onrender.com

TEST INTERFACE:
/sca/recordupload
```

Target result:

**PASS**

### Test C: Real ZY04

After supplier confirms the API test passes, give them the Render HTTPS host.

They will configure the badge to use the custom upload host.

Then make a short recording and verify:

```text
ZY04
→ our API
→ file received
→ metadata saved
→ slices handled
→ OPUS decoded
→ WAV generated
→ dashboard shows recording
→ Play works
```

## 13. Security

For this MVP:

- HTTPS
- validate required fields
- validate upload size
- sanitize filenames
- prevent path traversal
- generate IDs server-side
- keep secrets in environment variables
- do not expose supplier credentials
- do not expose raw uploaded files by predictable filename

Dashboard authentication is out of scope for this first test.

## 14. Environment Variables

Use environment variables:

```text
MONGODB_URI=
DATABASE_NAME=zy04_mvp
UPLOAD_DIR=
UPLOAD_DIR=
PORT=
```

Add object-storage variables only if object storage is used.

## 15. Explicitly Out of Scope

Do NOT build:

- Login
- User management
- Device registration UI
- Device assignment
- AI
- Speech-to-text
- Transcription
- Lead creation
- CRM
- Mobile app
- Analytics
- Notifications
- Payments
- Complex admin panel

## 16. Definition of Done

The MVP is complete when:

- [ ] Render deployment is live
- [ ] `POST /sca/recordupload` works over HTTPS
- [ ] Supplier Online Interface Tester returns PASS
- [ ] All documented multipart fields are received
- [ ] `record_file` is saved
- [ ] Metadata is saved
- [ ] Unique `record_id` is returned
- [ ] Multiple slices are handled
- [ ] `session_id` and `serial` are handled correctly
- [ ] ZY04 OPUS is decoded with `opus-decoder-core`
- [ ] WAV is generated
- [ ] Dashboard lists recordings
- [ ] Dashboard shows device SN, session, time, duration and status
- [ ] READY recording can be played
- [ ] Actual ZY04 successfully uploads a real recording to our server

## 17. Development Rule

Keep this MVP intentionally simple.

The only goal is:

**RECEIVE → SAVE → DECODE → SHOW → PLAY**

After this works with the real ZY04, a separate phase can add:

**Device Registration → User Assignment → Authentication → Transcription → AI → Sales Lead Integration**
