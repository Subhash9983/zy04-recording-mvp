# ZY04 Device Management System Implementation Plan

## 1. Goal

Existing ZY04 Recording MVP ko extend karke ek complete, simple Device Management System banana hai.

Final system ka flow:

```text
ZY04 Badge
  -> Time Sync
  -> Fetch Configuration
  -> Configuration Acknowledgement
  -> Status and Report Logs
  -> Debug Log Upload
  -> Recording Upload
  -> OTA Firmware Check
  -> Web Dashboard
```

Initial stack ko change nahi karna:

- Backend: Node.js, Fastify, TypeScript
- Database: MongoDB Atlas with Mongoose
- Frontend: React, TypeScript, Vite
- Deployment: Render
- Current file storage: Render temporary filesystem
- Permanent storage later: Cloudflare R2 or S3-compatible storage

System ko initially modular monolith rakhna hai. Microservices, Redis, queues, Kubernetes, aur unnecessary infrastructure abhi add nahi karna.

### Connected specification documents

Yeh backend master plan aur `ZY04-Admin-Dashboard-Frontend-Specification.md` ek hi application ke connected specifications hain.

- Yeh file supplier APIs, database, backend services, storage aur deployment ka source of truth hai.
- Frontend specification admin screens, actions, live monitoring, confirmations aur frontend API contracts ka source of truth hai.
- Frontend mein defined har management action ke liye is backend mein matching protected `/api/*` endpoint, database operation aur audit record required hai.
- Dono applications same MongoDB-backed device state use karengi.

Supplier se physical badge ka initial `domain_config`, `domain` aur `domain_apm` ek baar apne server par set hone ke baad documented configuration values dashboard se manage ki ja sakengi. Dashboard action pehle backend mein queue hoga aur badge ke next config/OTA fetch par deliver hoga.

---

## 2. Current Existing System

User-provided project status ke according Recording MVP already build, deploy, aur supplier tester se validate kiya ja chuka hai.

### Existing supplier endpoint

```http
POST /sca/recordupload
```

### Existing recording functionality

- Multipart recording upload
- Supplier ke documented fields receive karna
- Original recording slice save karna
- MongoDB mein metadata save karna
- Unique `record_id` return karna
- `session_id` aur `serial` se slices track karna
- LZ4 compressed upload handle karna
- Non-standard Opus ko WAV mein decode karna
- Recording list dashboard
- Decoded WAV playback

### Existing application APIs

```http
GET /api/recordings
GET /api/recordings/:recordId
GET /api/recordings/:recordId/audio
```

### Existing main files

```text
models/Recording.ts
routes/recordUpload.ts
routes/recordings.ts
services/audioService.ts
services/recordingService.ts
utils/serial.ts
```

Existing Recording MVP ko rewrite nahi karna. Remaining modules isi application mein add karne hain.

---

## 3. Remaining Supplier APIs to Build

| Module | Method | Endpoint | Purpose |
| --- | --- | --- | --- |
| Time | `GET` | `/sca/device/cloud_time` | Badge ko current server time dena |
| Configuration | `POST` | `/sca/device/config` | Pending configuration badge ko deliver karna |
| Configuration | `POST` | `/sca/device/config_status` | Badge se configuration acknowledgement receive karna |
| Logs | `POST` | `/sca/device/reportinfo` | Status aur report logs receive karna |
| Logs | `POST` | `/sca/device/debug_log` | Multipart debug-log file receive karna |
| OTA | `POST` | `/ota/v1/fetch_new_firmware` | Available firmware update return karna |

Existing endpoint:

| Module | Method | Endpoint | Status |
| --- | --- | --- | --- |
| Recording | `POST` | `/sca/recordupload` | Existing |

Supplier ke endpoint paths aur request field names change nahi karne.

---

## 4. Clean Final Folder Structure

```text
zy04-recording-mvp/
|
|-- backend/
|   |-- src/
|   |   |-- server.ts
|   |   |-- app.ts
|   |   |-- config.ts
|   |   |-- db.ts
|   |   |
|   |   |-- models/
|   |   |   |-- Recording.ts
|   |   |   |-- Device.ts
|   |   |   |-- DeviceConfig.ts
|   |   |   |-- DeviceLog.ts
|   |   |   |-- DebugLog.ts
|   |   |   |-- Firmware.ts
|   |   |   |-- Admin.ts
|   |   |   |-- ApiActivity.ts
|   |   |   |-- Alert.ts
|   |   |   `-- AuditLog.ts
|   |   |
|   |   |-- routes/
|   |   |   |-- recordUpload.ts
|   |   |   |-- recordings.ts
|   |   |   |-- deviceTime.ts
|   |   |   |-- deviceConfig.ts
|   |   |   |-- deviceLogs.ts
|   |   |   |-- deviceOta.ts
|   |   |   |-- dashboard.ts
|   |   |   |-- auth.ts
|   |   |   |-- apiActivity.ts
|   |   |   |-- alerts.ts
|   |   |   |-- systemHealth.ts
|   |   |   `-- auditLog.ts
|   |   |
|   |   |-- services/
|   |   |   |-- audioService.ts
|   |   |   |-- recordingService.ts
|   |   |   |-- deviceService.ts
|   |   |   |-- configService.ts
|   |   |   |-- logService.ts
|   |   |   |-- firmwareService.ts
|   |   |   |-- authService.ts
|   |   |   |-- activityService.ts
|   |   |   |-- alertService.ts
|   |   |   `-- auditService.ts
|   |   |
|   |   `-- utils/
|   |       |-- serial.ts
|   |       |-- files.ts
|   |       `-- response.ts
|   |
|   |-- uploads/
|   |   |-- recordings/
|   |   |-- debug-logs/
|   |   `-- firmware/
|   |
|   |-- .env
|   |-- .env.example
|   |-- package.json
|   |-- tsconfig.json
|   `-- .gitignore
|
`-- frontend/
    |-- src/
    |   |-- main.tsx
    |   |-- App.tsx
    |   |-- api.ts
    |   |-- auth.ts
    |   |-- sse.ts
    |   |-- types.ts
    |   |-- styles.css
    |   |
    |   |-- pages/
    |   |   |-- Login.tsx
    |   |   |-- Overview.tsx
    |   |   |-- Devices.tsx
    |   |   |-- DeviceDetails.tsx
    |   |   |-- Configurations.tsx
    |   |   |-- Firmware.tsx
    |   |   |-- Recordings.tsx
    |   |   |-- RecordingDetails.tsx
    |   |   |-- DeviceLogs.tsx
    |   |   |-- ApiActivity.tsx
    |   |   |-- Alerts.tsx
    |   |   |-- SystemHealth.tsx
    |   |   `-- AuditLog.tsx
    |   |
    |   `-- components/
    |       |-- Layout.tsx
    |       |-- Sidebar.tsx
    |       |-- Header.tsx
    |       |-- StatusBadge.tsx
    |       |-- MetricCard.tsx
    |       |-- DataTable.tsx
    |       |-- FilterBar.tsx
    |       |-- ConfirmModal.tsx
    |       |-- DetailDrawer.tsx
    |       |-- AlertCard.tsx
    |       |-- DeviceHealth.tsx
    |       |-- AudioPlayer.tsx
    |       `-- ProcessingTimeline.tsx
    |
    |-- package.json
    |-- tsconfig.json
    |-- vite.config.ts
    `-- index.html
```

### Folder structure rules

- Har supplier API ke liye unnecessary alag controller, repository aur DTO layers nahi banani.
- Route request/response handle karega.
- Business logic service mein rahega.
- Database schema model mein rahega.
- Shared parsing aur file safety logic `utils` mein rahega.
- Existing files ko rename ya rewrite tabhi karna jab required ho.
- No microservices in this phase.
- No separate mobile application.

---

## 5. MongoDB Collections

Minimum required collections:

```text
recordings
devices
deviceconfigs
devicelogs
debuglogs
firmwares
admins
apiactivities
alerts
auditlogs
```

### 5.1 `recordings`

Existing collection. Recording slices, metadata, processing status aur WAV path store karegi.

### 5.2 `devices`

Har badge ka latest known state store karegi.

```json
{
  "sn": "4S1006EC4281800450",
  "product": "SA01A1",
  "device_model": "SA01A1",
  "mac": "AA:BB:CC:DD:EE:FF",
  "esp_version": "2.2.32",
  "dsp_version": "1.0.16",
  "power": 100,
  "current": 5,
  "wifi": {
    "ssid": "WiFi-SSID",
    "rssi": -89
  },
  "storage": {
    "total": 7816216576,
    "free": 7813890048,
    "used": 2326528
  },
  "last_seen_at": "2026-09-13T10:00:00.000Z",
  "created_at": "2026-09-13T10:00:00.000Z",
  "updated_at": "2026-09-13T10:00:00.000Z"
}
```

Required index:

```text
{ sn: 1 } unique
```

Unknown badge request aane par initial phase mein device ko automatically create/upsert karna hai.

### 5.3 `deviceconfigs`

Admin se created configuration aur badge delivery status store karegi.

```json
{
  "session_id": 492,
  "device_sn": "4S1006EC4281800450",
  "device_model": "SA01A1",
  "values": {
    "record_time": 3600,
    "record_mode": 0,
    "domain": "api.example.com",
    "domain_apm": "api.example.com",
    "domain_config": "api.example.com"
  },
  "status": "PENDING",
  "delivered_at": null,
  "acknowledged_at": null,
  "created_at": "2026-09-13T10:00:00.000Z",
  "updated_at": "2026-09-13T10:00:00.000Z"
}
```

Configuration status values:

```text
PENDING
DELIVERED
SUCCESS
FAILED
```

Required indexes:

```text
{ session_id: 1 } unique
{ device_sn: 1, status: 1, created_at: 1 }
```

### 5.4 `devicelogs`

Report aur status log dono same collection mein store honge.

```json
{
  "device_sn": "4S1006EC4281800450",
  "type": "STATUS",
  "product": "SA01A1",
  "esp_version": "2.2.32",
  "dsp_version": "1.0.16",
  "payload": {},
  "received_at": "2026-09-13T10:00:00.000Z"
}
```

Log type:

```text
STATUS
REPORT
```

Required index:

```text
{ device_sn: 1, received_at: -1 }
```

Status log receive hote hi `devices` collection ka latest status bhi update karna hai.

### 5.5 `debuglogs`

Debug file metadata store karegi. File database ke andar store nahi hogi.

```json
{
  "device_sn": "4S1006EC4281800450",
  "ts": "1767594238886",
  "file_name": "debug.log",
  "file_path": "uploads/debug-logs/...",
  "size": 1024,
  "created_at": "2026-09-13T10:00:00.000Z"
}
```

### 5.6 `firmwares`

Available firmware packages store karegi.

```json
{
  "device_model": "SA01A1",
  "firmware_type": "esp",
  "firmware_version": "2.2.33",
  "url": "https://example.com/firmware.bin",
  "md5": "78e503f18619df840ab64a0ac6dc0dd8",
  "update_type": "force",
  "active": true,
  "created_at": "2026-09-13T10:00:00.000Z"
}
```

Required index:

```text
{ device_model: 1, firmware_type: 1, firmware_version: 1 } unique
```

### 5.7 `admins`

Single admin login account store karegi. Password ka plain text kabhi store nahi karna; strong password hash store karna.

### 5.8 `apiactivities`

Har supplier API request ka sanitized request, response, timing aur result 30 days ke liye store karegi. `expires_at` par TTL index required hai. Authorization, cookies aur secrets store nahi karne.

### 5.9 `alerts`

Offline, low battery, low storage, API failure, recording upload failure aur configuration failure alerts store karegi. Same active condition ka duplicate alert create nahi karna. Recovery par auto-resolve karke history preserve karni.

### 5.10 `auditlogs`

Har admin management action ka immutable record store karegi. Audit history permanently preserve karni hai; TTL index nahi lagana.

---

## 6. Supplier API Implementation Rules

### 6.1 Time Sync

```http
GET /sca/device/cloud_time
```

Response:

```json
{
  "code": 0,
  "data": {
    "create_time": 1767594238886
  }
}
```

Rules:

- `Date.now()` ka 13-digit millisecond timestamp return karna.
- Database query required nahi hai.
- Response fast hona chahiye.

### 6.2 Fetch Configuration

```http
POST /sca/device/config
```

Flow:

1. `product`, `sn`, aur `version` validate karo.
2. Device ko create/update karo.
3. Is badge ka oldest `PENDING` configuration find karo.
4. Pending configuration mile toh `code: 0` ke saath return karo.
5. Configuration ko `DELIVERED` mark karo.
6. Pending configuration na mile toh non-zero `code` return karo.

Configuration response ke `data` mein `session_id`, `device_model`, aur configuration values flat key-value form mein honi chahiye.

### 6.3 Configuration Status

```http
POST /sca/device/config_status
```

Flow:

1. `sn`, `session_id`, aur `status` validate karo.
2. Matching configuration find karo.
3. `status = success` ho toh configuration ko `SUCCESS` mark karo.
4. Failure response ho toh `FAILED` mark karo.
5. Same acknowledgement dobara aaye toh safely `code: 0` return karo.

Duplicate acknowledgement ko error nahi banana. Endpoint idempotent hona chahiye.

### 6.4 Report and Status Log

```http
POST /sca/device/reportinfo
```

Flow:

1. `common.sn` validate karo.
2. `dev_info.status` present ho toh type `STATUS`.
3. Otherwise type `REPORT`.
4. Complete original payload `devicelogs` mein save karo.
5. Device firmware versions aur `last_seen_at` update karo.
6. Status log ho toh battery, storage, Wi-Fi aur current state update karo.
7. `{ "code": 0 }` return karo.

### 6.5 Debug Log

```http
POST /sca/device/debug_log
Content-Type: multipart/form-data
```

Flow:

1. `sn`, `ts`, aur `log_file` validate karo.
2. Filename sanitize karo.
3. Upload-size limit enforce karo.
4. File ko `uploads/debug-logs/<sn>/` mein save karo.
5. Metadata `debuglogs` collection mein save karo.
6. `{ "code": 0 }` return karo.

Deprecated `create_time` field par depend nahi karna.

### 6.6 OTA Firmware Check

```http
POST /ota/v1/fetch_new_firmware
```

Flow:

1. `sn`, `device_model`, aur `fetch_firmware` validate karo.
2. Device ke reported ESP/DSP versions update karo.
3. Har requested firmware type ke liye active compatible firmware find karo.
4. `current_firmware` mein badge ka request data return karo.
5. Upgrade available ho toh `latest_firmware` mein package return karo.
6. Upgrade available nahi ho toh `latest_firmware: []` return karo.

Firmware URL public HTTPS URL hona chahiye aur MD5 correct hona chahiye.

---

## 7. Our Dashboard APIs

Supplier APIs ke alawa frontend specification ko support karne ke liye ye protected APIs build karni hain:

```http
POST /api/admin/login
POST /api/admin/logout
GET  /api/admin/session

GET /api/dashboard/summary
GET /api/dashboard/attention

GET /api/devices
GET /api/devices/:sn
GET /api/devices/:sn/activity

GET  /api/configurations
POST /api/configurations
GET  /api/configurations/:id
POST /api/configurations/:id/cancel
POST /api/configurations/:id/retry

GET  /api/firmware
POST /api/firmware/upload
POST /api/firmware/url
GET  /api/firmware/:id
POST /api/firmware/:id/activate
POST /api/firmware/:id/deactivate

GET  /api/logs/status
GET  /api/logs/report
GET  /api/logs/debug
GET  /api/logs/debug/:id/download
DELETE /api/logs/debug/:id

GET /api/api-activity
GET /api/api-activity/:id
GET /api/api-activity/stream

GET /api/alerts
GET /api/system/health
GET /api/audit-log
```

Existing APIs remain unchanged:

```http
GET /api/recordings
GET /api/recordings/:sessionId
GET /api/recordings/:sessionId/audio
GET /api/recordings/:sessionId/download
GET /api/recordings/:sessionId/slices/:sliceId/download
POST /api/recordings/:sessionId/retry
```

Dashboard login required hai. Admin session 24 hours valid rahega. Supplier `/sca/*` aur `/ota/*` badge endpoints admin authentication ke peeche nahi honge.

Every mutating admin endpoint successful ya failed audit record create karega.

---

## 8. Frontend Pages

Full page behaviour, UI states aur frontend implementation ka canonical source `ZY04-Admin-Dashboard-Frontend-Specification.md` hai.

### Dashboard

Show:

- Total devices
- Online/recently seen devices
- Recording devices
- Low-battery devices
- Failed uploads
- Total recordings
- Urgent alerts first
- Live API activity
- System health summary

### Devices

Show:

- Device SN
- Product/model
- ESP and DSP versions
- Battery
- Current state
- Wi-Fi signal
- Last seen

### Device Details

Show:

- Latest status
- Storage information
- Firmware versions
- Recent logs
- Pending/applied configurations
- New configuration form
- Recordings for the device

### Recordings

Existing recording list and player continue karna.

### Firmware

Show:

- Device model
- Firmware type
- Version
- MD5
- Download URL
- Update type
- Active/inactive status

Additional required pages:

- Login
- Configurations
- Device Logs
- API Activity
- Alerts
- System Health
- Audit Log

---

## 9. Build Phases

Har phase independently build, deploy aur supplier tester se verify karna hai.

### Phase 1: Time Sync

- `deviceTime.ts`
- `GET /sca/device/cloud_time`
- Deploy
- Supplier tester PASS

### Phase 2: Device Model and Config Fetch

- `Device.ts`
- `DeviceConfig.ts`
- `deviceService.ts`
- `configService.ts`
- `POST /sca/device/config`
- Pending/no-pending cases test
- Supplier tester PASS

### Phase 3: Config Acknowledgement

- `POST /sca/device/config_status`
- Success, failure, duplicate acknowledgement handling
- Supplier tester PASS

### Phase 4: Status and Report Logs

- `DeviceLog.ts`
- `logService.ts`
- `POST /sca/device/reportinfo`
- Status/report payload detection
- Device latest status update
- Both supplier tests PASS

### Phase 5: Debug Logs

- `DebugLog.ts`
- Multipart file upload
- Safe file storage
- Supplier tester PASS

### Phase 6: OTA

- `Firmware.ts`
- `firmwareService.ts`
- `POST /ota/v1/fetch_new_firmware`
- ESP/DSP response handling
- Supplier tester PASS

### Phase 7: Dashboard APIs

- Admin authentication
- Device list and details
- Logs and configuration history
- Firmware management
- Dashboard summary
- API Activity with SSE
- Alerts and auto-resolution
- System health
- Permanent audit log

### Phase 8: Frontend

- Admin login and protected routes
- Problems-first Overview
- Device list
- Device detail with separate API tabs
- Configuration management
- Firmware/OTA management
- Recordings with sessions, slices, timeline and downloads
- Device Logs
- Live API Activity
- Alerts, System Health and Audit Log

### Phase 9: Permanent Storage

Real badge production usage se pehle:

- Recording files R2/S3 par move karo.
- Debug logs R2/S3 par move karo.
- Firmware files R2/S3 par store karo.
- MongoDB mein local file paths ki jagah object keys/URLs store karo.

### Phase 10: Physical Badge Provisioning

System APIs complete aur tested hone ke baad supplier se badge ka initial `domain_config`, `domain`, aur `domain_apm` apne server par set karwana.

---

## 10. Environment Variables

```env
PORT=3000
MONGODB_URI=
DATABASE_NAME=zy04_mvp
UPLOAD_DIR=./uploads
FRONTEND_URL=http://localhost:5173
MAX_RECORDING_UPLOAD_BYTES=
MAX_DEBUG_LOG_UPLOAD_BYTES=
```

Permanent object storage add karne ke baad:

```env
S3_ENDPOINT=
S3_REGION=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
```

Real credentials source code ya `.env.example` mein commit nahi karne.

---

## 11. Common Backend Rules

- Supplier request field names exactly preserve karo.
- Supplier endpoints par expected JSON response format preserve karo.
- Every response mein correct `Content-Type` aur `Content-Length` ensure karo.
- Request ko 30 seconds ke andar response dena hai.
- Slow file processing response se pehle mat chalao.
- Required fields validate karo.
- Upload size limit enforce karo.
- Filenames sanitize karo aur path traversal prevent karo.
- Device SN aur session values ko direct filesystem path mein trust mat karo.
- Unknown extra supplier fields ko unnecessarily reject mat karo.
- Duplicate requests safely handle karo.
- Raw device logs preserve karo, taaki future debugging possible ho.
- Errors internally log karo, lekin supplier response structure break mat karo.
- Production mein HTTPS required hai.

---

## 12. Scope Control

Is implementation phase mein ye features add nahi karne:

- Mobile application
- Speech-to-text
- AI analysis
- CRM integration
- Lead management
- Payments
- Notifications
- Multi-tenant organizations
- Microservices
- Kubernetes

Pehle complete badge communication, device visibility, configuration, logs, recordings aur OTA stable banana hai.

---

## 13. Final Definition of Done

- [ ] Existing Recording Upload remains working
- [ ] Time Sync tester PASS
- [ ] Config Fetch tester PASS
- [ ] Config Status tester PASS
- [ ] Report Log tester PASS
- [ ] Status Log tester PASS
- [ ] Debug Log tester PASS
- [ ] OTA tester PASS
- [ ] Devices automatically appear in database
- [ ] Latest battery, storage, network and state are visible
- [ ] Configuration can be created from dashboard
- [ ] Configuration delivery and acknowledgement status are visible
- [ ] Firmware can be registered and returned to compatible badges
- [ ] Recordings remain visible and playable
- [ ] All endpoints are deployed over HTTPS
- [ ] Admin login and 24-hour session work
- [ ] Dashboard and backend contracts match the frontend specification
- [ ] Every management action creates an audit record
- [ ] Live API Activity works through SSE
- [ ] Alerts auto-resolve and preserve history
- [ ] Permanent file storage is enabled before production rollout
- [ ] Supplier configures physical badge domains to our server
- [ ] Real physical badge completes end-to-end test

---

## 14. Immediate Next Step

Start only with Phase 1:

```text
GET /sca/device/cloud_time
```

Phase 1 complete, deploy aur tester PASS hone ke baad hi Phase 2 start karna.
