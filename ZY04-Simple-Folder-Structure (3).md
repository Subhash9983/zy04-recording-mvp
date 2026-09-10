# ZY04 Simple Web Application - Folder Structure

Goal: ZY04 Smart Recording Badge ke liye **minimum possible backend + web frontend** banana.

This is a **web application only**. It will run in a browser. No Android or iOS/mobile app is part of this project.

No testing files, no demo files, no unnecessary config/docs during development.

## Final Project Structure

```text
zy04-recording-mvp/
│
├── backend/
│   ├── src/
│   │   ├── server.ts
│   │   ├── app.ts
│   │   ├── config.ts
│   │   ├── db.ts
│   │   ├── models/
│   │   │   └── Recording.ts
│   │   ├── routes/
│   │   │   ├── recordUpload.ts
│   │   │   └── recordings.ts
│   │   ├── services/
│   │   │   ├── audioService.ts
│   │   │   └── recordingService.ts
│   │   └── utils/
│   │       └── serial.ts
│   │
│   ├── uploads/
│   │   └── .gitkeep
│   │
│   ├── .env
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   └── .gitignore
│
└── frontend/
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── api.ts
    │   ├── types.ts
    │   ├── components/
    │   │   ├── RecordingList.tsx
    │   │   └── AudioPlayer.tsx
    │   └── styles.css
    │
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    └── index.html
```

## Important Rule

Development ke time **extra testing files, sample files, mock files, seed files, Postman collections, test folders, ya unnecessary documentation files create nahi karne hain**.

Testing ke liye Postman/curl/browser ya supplier tester use karenge. Separate test files nahi banane.

---

# Backend

Backend ka kaam:

1. ZY04 se recording receive karna.
2. `POST /sca/recordupload` handle karna.
3. Audio file ko temporary `uploads/` mein save karna.
4. Metadata MongoDB Atlas mein save karna.
5. `session_id` + `serial` se slices ko track karna.
6. LZ4 compression aaye to handle karna.
7. Supplier ke `opus-decoder-core` se required audio ko WAV mein decode karna.
8. Frontend ko recordings list dena.
9. Frontend ko audio playback ke liye file serve karna.

## Backend Files

### `src/server.ts`

Server start karega.

### `src/app.ts`

Fastify app, plugins aur routes register karega.

### `src/config.ts`

Environment variables read/validate karega.

### `src/db.ts`

MongoDB Atlas connection.

### `src/models/Recording.ts`

MongoDB `recordings` collection ka Mongoose model.

### `src/routes/recordUpload.ts`

Supplier ka exact endpoint:

```text
POST /sca/recordupload
```

Is route mein supplier ke documented form-data fields receive honge:

```text
sn
esp_version
dsp_version
file_name
mac
session_id
create_time
duration
audio_type
channel
sample_rate
frame_size_ms
frame_rate
sig_type
compress
record_file
serial
```

Response:

```json
{
  "code": 0,
  "data": {
    "record_id": "server-generated-id"
  }
}
```

### `src/routes/recordings.ts`

Frontend ke simple dashboard APIs:

```text
GET /api/recordings
GET /api/recordings/:id
GET /api/recordings/:id/audio
```

### `src/services/audioService.ts`

Audio save, compression handling aur OPUS → WAV decoding.

### `src/services/recordingService.ts`

Recording metadata, slices aur MongoDB operations.

### `src/utils/serial.ts`

`serial` ko parse karega aur:

- slice number nikalega
- end-of-slice/end marker identify karega
- correct ordering mein help karega

### `src/models/Recording.ts`

Minimal document:

```json
{
  "record_id": "rec_xxx",
  "device_sn": "ZY04-SN",
  "mac": "AA:BB:CC:DD:EE:FF",
  "session_id": "session_xxx",
  "file_name": "record.opus",
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
  "original_file_path": "uploads/...",
  "wav_file_path": "uploads/...",
  "status": "RECEIVED",
  "created_at": "..."
}
```

---

# Temporary Audio Storage

Phase 1 mein permanent object storage nahi lagana.

```text
backend/uploads/
```

Example:

```text
backend/uploads/
└── ZY04-SN/
    └── session-123/
        ├── 00000001.opus
        ├── 00000002.opus
        ├── 00010003.opus
        └── recording.wav
```

MongoDB Atlas mein audio binary store nahi karni.

MongoDB mein sirf metadata + file paths store honge.

**Important:** Render local filesystem temporary hai. Restart/redeploy ke baad files disappear ho sakti hain. Phase 1 supplier API test ke liye ye acceptable hai.

---

# Environment File

Backend mein ek `.env` file hogi.

```env
PORT=3000
MONGODB_URI=mongodb+srv://YOUR_USER:YOUR_PASSWORD@YOUR_CLUSTER.mongodb.net/
DATABASE_NAME=zy04_mvp
UPLOAD_DIR=./uploads
FRONTEND_URL=http://localhost:5173
```

### Credentials

`.env` mein sirf required secrets/configuration rakhenge:

- MongoDB Atlas connection string
- database name
- upload directory
- frontend URL
- production mein required port/config

**Real password ya credentials source code mein hard-code nahi karne hain.**

`.env` ko Git mein commit nahi karna.

`.env.example` mein sirf placeholder values hongi:

```env
PORT=3000
MONGODB_URI=
DATABASE_NAME=zy04_mvp
UPLOAD_DIR=./uploads
FRONTEND_URL=http://localhost:5173
```

---

# Frontend

Web frontend bahut simple browser-based dashboard hoga.

## Web Frontend Files

### `src/main.tsx`

React web application entry point.

### `src/App.tsx`

Main dashboard.

### `src/api.ts`

Backend APIs call karega.

### `src/types.ts`

Recording TypeScript types.

### `src/components/RecordingList.tsx`

Received recordings ki list.

Show:

```text
Device
Session
File
Time
Duration
Status
Play
```

### `src/components/AudioPlayer.tsx`

WAV/audio playback.

### `src/styles.css`

Simple dashboard styling.

---

# What Frontend Should Look Like

Simple screen:

```text
ZY04 Recording Dashboard

------------------------------------------------------------
Device       Session       Time        Duration    Status
------------------------------------------------------------
ZY04-001     session-01    10:30 AM    00:32       READY
                                      [▶ Play]
------------------------------------------------------------
ZY04-001     session-02    10:35 AM    01:10       READY
                                      [▶ Play]
------------------------------------------------------------
```

No mobile application.

No login.

No users.

No device registration UI.

No AI.

No speech-to-text.

No analytics.

No CRM.

No unnecessary pages.

---

# Packages

## Backend

Only required packages.

Core:

```text
fastify
mongoose
dotenv
@fastify/multipart
@fastify/static
@fastify/cors
```

Plus only the packages actually required by the chosen OPUS/LZ4 decoding implementation.

Do not install unnecessary libraries.

## Web Frontend

Use:

```text
react
react-dom
typescript
vite
```

No UI framework is required for this MVP.

---

# Development Principle

Build in this exact order:

```text
1. MongoDB connection
        ↓
2. POST /sca/recordupload
        ↓
3. Receive multipart form-data
        ↓
4. Save audio to /uploads
        ↓
5. Save metadata to MongoDB
        ↓
6. Return supplier response
        ↓
7. Decode audio to WAV
        ↓
8. GET /api/recordings
        ↓
9. Web frontend dashboard
        ↓
10. Audio playback
        ↓
11. Deploy backend to Render
        ↓
12. Supplier API test
```

# Final Rule

**Keep the project intentionally small.**

Agar koi file required nahi hai to create mat karo.

Phase 1 ka target sirf:

**RECEIVE → SAVE → STORE METADATA → DECODE → SHOW → PLAY → SUPPLIER TEST**
