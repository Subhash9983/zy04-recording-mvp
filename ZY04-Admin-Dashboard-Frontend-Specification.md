# ZY04 Admin Dashboard Frontend Specification

## 1. Product Goal

ZY04 Smart Badge ke liye ek admin-only web dashboard banana hai jo monitoring aur management dono support kare.

Admin dashboard se:

- Devices ki current health dekhi ja sake.
- Har supplier API ka request/response flow inspect kiya ja sake.
- Device configurations create aur assign ki ja saken.
- OTA firmware manage kiya ja sake.
- Recordings play, inspect aur download ki ja saken.
- Status, report aur debug logs dekhe ja saken.
- Problems aur urgent alerts track kiye ja saken.
- Backend, database, storage aur decoder health monitor ki ja sake.

Dashboard desktop-first responsive web application hoga. Is phase mein mobile application nahi banani.

### Connected backend specification

Yeh frontend specification aur `ZY04-Device-Management-System-Implementation-Plan.md` ek hi system ke connected documents hain.

- Backend plan supplier endpoints, MongoDB models, services, storage aur protected admin APIs define karta hai.
- Yeh file un backend capabilities ke dashboard pages, controls aur interaction rules define karti hai.
- Frontend ka koi management button matching backend endpoint aur audit record ke bina implement nahi karna.
- Backend ka device state dashboard par same MongoDB records se load hoga.

---

## 2. Locked Product Decisions

### Admin and authentication

- Dashboard sirf single admin use karega.
- Login email and password se hoga.
- Authenticated session 24 hours valid rahega.
- Dashboard management actions ki audit history permanently preserve hogi.

### Monitoring behaviour

- Home screen par problems aur urgent alerts sabse prominent honge.
- API Activity live automatic updates use karegi.
- Live updates ke liye Server-Sent Events, SSE, use karna hai.
- Device 5 minutes tak koi request na bheje toh offline maana jayega.

### Alert rules

- Battery `20%` ya usse kam ho toh Low Battery alert.
- Free storage `10%` ya usse kam ho toh Storage alert.
- API request failure par alert.
- Recording upload failure par alert.
- Configuration failure par alert.
- Device offline hone par alert.
- Problem recover hone par alert automatically resolve hoga.
- Resolved alert history delete nahi hogi.

### Device presentation

- Device identity ke liye sirf badge serial number, SN, use hoga.
- Device list mein attention-required devices sabse upar honge.
- Device detail screen mein supplier APIs separate tabs mein hongi.

### API Activity

- Full request and response details visible honge.
- Sensitive values mask honge.
- API activity history 30 days preserve hogi.
- Request successful tab maana jayega jab HTTP status aur supplier response code dono valid hon.
- Uploaded binary content show nahi hoga. Sirf file metadata show hoga.

### Configuration management

- Configuration form mein Common aur Advanced sections honge.
- Configuration single aur multiple devices par apply ho sakegi.
- Har configuration submission par confirmation required hai.
- Bulk configuration mein har badge ke liye separate `session_id` aur tracking record create hoga.

### Firmware and OTA

- Firmware file upload aur existing public URL dono supported honge.
- OTA device model ke sab badges ke liye activate hogi.
- Firmware downgrade Advanced action hoga aur confirmation required hogi.

### Recordings

- Recording list ki primary row ek session represent karegi.
- Session row ke andar individual slices expand honge.
- Full processing timeline visible hogi.
- Admin decoded WAV aur original slices dono download kar sakega.
- Failed recording processing ko dashboard se retry kiya ja sakega.

### Device logs

- Status, Report aur Debug ke separate tabs honge.
- Status aur Report logs parsed readable format mein show honge.
- Original raw payload backend mein preserve hoga, frontend par show nahi hoga.
- Debug-log files download aur delete ki ja sakengi.

---

## 3. Important Device-Control Behaviour

Dashboard directly badge ko live command push nahi karta. Supplier documentation polling-based flow define karti hai.

```text
Admin creates action
  -> Backend desired state save karta hai
  -> Action PENDING hota hai
  -> Badge server API call karta hai
  -> Backend action/configuration return karta hai
  -> Badge acknowledgement bhejta hai
  -> Dashboard SUCCESS ya FAILED show karta hai
```

Offline device ke liye action queued rahega. Device online aakar `/sca/device/config` call karega tab configuration deliver hogi.

Supplier physical badge mein initial `domain_config`, `domain` aur `domain_apm` ek baar apne server par configure karega. Uske baad API documentation mein available settings dashboard ke Common/Advanced configuration form se manage ki ja sakengi. Domain settings change karte waqt connection-loss warning mandatory hai.

Supplier documentation ke according dashboard se directly ye actions possible nahi hain:

- Instant recording start/stop command
- Instant device reboot
- On-demand status request
- On-demand upload request
- Direct device enable/disable

`no_switch` physical switch behaviour control karta hai. Yeh remote device enable/disable command nahi hai.

### Supplier API to dashboard connection

| Supplier API | Backend responsibility | Dashboard visibility/action |
| --- | --- | --- |
| `GET /sca/device/cloud_time` | Current server timestamp return karna | Time Sync tab mein calls, response time aur result |
| `POST /sca/device/config` | Pending configuration badge ko deliver karna | Configuration create, queue, delivery status aur history |
| `POST /sca/device/config_status` | Badge acknowledgement receive karna | Configuration SUCCESS/FAILED status, retry action |
| `POST /sca/device/reportinfo` | Status/report logs store karna aur latest device health update karna | Device health, Status Logs, Report Logs aur alerts |
| `POST /sca/device/debug_log` | Debug file aur metadata store karna | Debug list, download aur delete |
| `POST /sca/recordupload` | Recording slices receive/process karna | Session, slices, timeline, play, download aur retry |
| `POST /ota/v1/fetch_new_firmware` | Matching active firmware return karna | Firmware registration, model-wide activation aur OTA observations |

Har supplier API call `API Activity` mein visible hogi. Supplier endpoints public badge-facing rahenge; management endpoints authenticated admin-facing rahenge.

---

## 4. Main Navigation

Desktop sidebar:

```text
ZY04 Admin

Overview
Devices
Configurations
Firmware / OTA
Recordings
Device Logs
API Activity
Alerts
System Health
Audit Log

Admin Account
Logout
```

### Navigation rules

- Active page clearly highlighted ho.
- Sidebar collapsible ho sakti hai, lekin default expanded rahe.
- Alerts menu ke saath active-alert count badge ho.
- API Activity ke saath live connection indicator ho.
- Header mein page title, last refreshed time, live status aur admin menu ho.

---

## 5. Global UI Structure

```text
+-----------------------------------------------------------+
| Sidebar | Header: Page Title | Live | Last Updated | Admin |
|         +-------------------------------------------------+
|         |                                                 |
|         | Page Content                                    |
|         |                                                 |
|         |                                                 |
+-----------------------------------------------------------+
```

### Reusable visual statuses

| Status | Colour purpose |
| --- | --- |
| Green | Healthy, online, ready, success |
| Red | Failure, offline, critical alert |
| Orange | Warning, low battery, low storage |
| Blue | Processing, delivered, informational |
| Grey | Pending, inactive, unknown |

Colour ke saath text aur icon bhi use karna hai. Sirf colour par meaning depend nahi karni.

### Common components

- Status badge
- Health indicator
- Metric card
- Search input
- Filter bar
- Sortable table
- Pagination
- Empty state
- Loading skeleton
- Error state with Retry
- Confirmation modal
- Detail drawer
- Date and time formatter
- File-size formatter
- Battery indicator
- Storage usage bar
- Wi-Fi signal indicator
- Toast notification

---

## 6. Login Page

Route:

```text
/login
```

Show:

- ZY04 logo/title
- Email field
- Password field
- Show/hide password
- Sign In button
- Invalid credentials error
- Loading state

Rules:

- Successful login ke baad `/overview` open ho.
- Session 24 hours valid ho.
- Expired session par login page redirect ho.
- Password frontend storage mein save nahi karna.
- Authentication token secure HTTP-only cookie mein rakhna preferred hai.
- Supplier badge endpoints ko admin authentication ke peeche nahi rakhna.

---

## 7. Overview Dashboard

Route:

```text
/overview
```

Home screen ka main goal: admin ko immediately batana ki kya problem hai aur system abhi kya kar raha hai.

### Section 1: Critical alert strip

Page ke top par unresolved critical alerts:

```text
3 devices need attention
2 devices offline | 1 recording upload failed
```

Actions:

- `View All Alerts`
- Alert card click karke related device/request open karna

### Section 2: Main metric cards

```text
Total Devices
Online Devices
Offline Devices
Devices Recording
Active Alerts
Recordings Today
API Success Rate
Failed Requests Today
```

Card click relevant filtered page open kare.

### Section 3: Devices requiring attention

Columns:

```text
Device SN | Problem | Battery | Storage | Last Seen | Severity | Open
```

Priority:

1. Offline
2. API/recording/configuration failed
3. Storage low
4. Battery low

### Section 4: Live API activity

Latest live requests:

```text
Time | Device SN | Endpoint | Result | Response Time
```

Maximum latest 10 activities show karni hain. `View All` se API Activity page open ho.

### Section 5: Recent recording activity

```text
Device SN | Session | Duration | Slices | Processing Stage | Time | Open
```

### Section 6: System status

Compact indicators:

```text
Backend
MongoDB
File Storage
Audio Decoder
Live Activity Stream
```

---

## 8. Devices Page

Route:

```text
/devices
```

### Summary filters

```text
All
Online
Offline
Recording
Attention Required
Low Battery
Low Storage
```

### Device table

```text
Status
Device SN
Product / Model
Battery
Storage Free
Wi-Fi
Current Mode
ESP Version
DSP Version
Last Seen
Active Alerts
Open
```

### Default ordering

1. Attention-required devices
2. Severity
3. Most recently active

### Actions

- Search by SN
- Filter by status/model/firmware
- Open device details
- Select one or multiple devices
- Create configuration for selected devices

Direct device delete initially nahi dena. Historical requests ke saath device identity preserve honi chahiye.

---

## 9. Device Details Page

Route:

```text
/devices/:sn
```

### Header

Show:

- Device SN
- Online/offline status
- Current operating state
- Last seen
- Active alert count
- `Create Configuration` action

### Health summary

```text
Battery
Storage
Wi-Fi SSID and RSSI
Product/model
ESP version
DSP version
Hub SN, if present
Last status received
```

### Separate API tabs

User decision ke according combined timeline use nahi karni. Tabs:

```text
Overview
Time Sync
Config Fetch
Config Status
Status Logs
Report Logs
Debug Logs
Recording Uploads
OTA Checks
```

Har API tab mein:

```text
Request Time
Endpoint
HTTP Status
Supplier Code
Response Time
Result
Open Details
```

Config-related tabs mein configuration `PENDING`, `DELIVERED`, `SUCCESS`, aur `FAILED` status bhi show karna.

---

## 10. Configurations Page

Route:

```text
/configurations
```

### Configuration list

```text
Session ID
Target Device SN
Created Time
Status
Delivered Time
Acknowledged Time
Changed Fields
Open
```

Filters:

```text
PENDING
DELIVERED
SUCCESS
FAILED
Device SN
Date range
```

### Create configuration flow

1. Select single or multiple devices.
2. Common settings fill karo.
3. Optional Advanced section open karo.
4. Only changed fields summary generate karo.
5. Confirmation modal show karo.
6. Confirm hone par har selected device ke liye separate configuration/session create karo.
7. Result summary show karo.

### Common settings

```text
record_mode
record_time
record_ignore_time
retry_delay
duor
no_switch
preferred_network
tz
compress
```

Form controls:

- Boolean values ke liye toggle
- Enum values ke liye select
- Numeric values ke liye min/max validation
- Timezone ke liye input/select
- Field description aur documented default show karna

### Advanced settings

```text
domain
domain_apm
domain_config
s3_config
s3_callback
snapshot_status
disable_tls
http_proxy
extra_headers
modem_apn
```

`s3_config` mein secret credentials ho sakte hain. Existing secret values frontend ko plaintext mein return nahi karne. Masked value show karni aur replacement-only editing use karni.

### High-risk fields

```text
domain_config
domain
domain_apm
s3_config
disable_tls
no_switch
```

High-risk field change par confirmation modal mein warning prominently show ho.

### Confirmation modal

Har configuration submission par show:

```text
Selected devices
Changed keys
Old values, if known
New values
High-risk warnings
Delivery behaviour: waits for device fetch
```

Actions:

- Confirm and Queue
- Cancel

### Configuration management actions

- Pending configuration view
- Pending configuration cancel
- Failed configuration ko new session ke saath retry
- Successful configuration history view

Already delivered configuration ko silently edit nahi karna. Change ke liye new configuration create karni.

---

## 11. Firmware / OTA Page

Route:

```text
/firmware
```

### Firmware table

```text
Device Model
Firmware Type
Version
Source
MD5
Update Type
Status
Created Time
Actions
```

Firmware type:

```text
ESP
DSP
```

Status:

```text
DRAFT
ACTIVE
INACTIVE
```

### Add firmware methods

#### File upload

- `.bin` firmware file upload
- Backend file store kare
- Backend MD5 calculate kare
- Public HTTPS download URL generate kare
- Record initially `DRAFT` ho

#### External URL

- Public HTTPS URL enter karo
- Firmware version/type/model enter karo
- MD5 enter ya server verification use karo
- URL availability validate karo
- Record initially `DRAFT` ho

### Rollout scope

OTA selected device model ke sab badges ke liye active hogi.

Activation confirmation:

```text
Device model
Firmware type
Current active version
New version
Normal or Force
Approximate affected device count
```

### Downgrade

- Advanced action mein rahe.
- `force` update type required hoga.
- Current aur target version prominently show hon.
- Explicit confirmation required ho.

### OTA visibility

Firmware details mein show:

- Total matching devices
- Devices that checked OTA
- Current versions distribution
- Latest OTA API responses

Supplier documentation installation-complete callback define nahi karti. Actual update success ko later device-reported firmware version se infer karna hoga. UI mein isko `Observed Version` kehna, guaranteed installation acknowledgement nahi.

---

## 12. Recordings Page

Route:

```text
/recordings
```

### Session-level table

```text
Device SN
Session ID
Start Time
Total Duration
Received Slices
Final Slice
Current Stage
Status
Actions
```

Filters:

```text
Device SN
READY
PROCESSING
FAILED
Date range
Compressed/uncompressed
```

### Expandable slices

Session expand hone par:

```text
Slice Number
Raw Serial
End Marker
Filename
Size
Create Time
Upload Time
Compression
Upload Result
```

### Recording processing timeline

```text
Session Created
Slice Received
LZ4 Decompressed, if applicable
Final Slice Detected
Slice Validation Completed
Decoding Started
WAV Generated
Ready
```

Failure par:

- Failed stage red show ho.
- Error reason show ho.
- Failure time show ho.
- `Retry Processing` action show ho.

### Recording actions

- Play decoded WAV
- Pause/seek/volume
- Download WAV
- Download individual original slice
- Download all original slices
- Retry failed processing
- Open related recording-upload API activity

Delete recording action initial frontend scope mein include nahi karna, jab tak retention policy separately final na ho.

---

## 13. Device Logs Page

Route:

```text
/logs
```

Separate tabs:

```text
Status Logs
Report Logs
Debug Logs
```

### Status Logs tab

List columns:

```text
Time
Device SN
Battery
Current State
Storage Free
Wi-Fi SSID
Wi-Fi RSSI
Local Files
Hub SN
Open
```

Readable detail sections:

- Battery and state
- Storage summary
- Wi-Fi information
- Hub information
- Local files
- Debug/report counts

### Report Logs tab

List columns:

```text
Time
Device SN
Wi-Fi Events
Audio Slices
Bluetooth Events
Upload Events
Power Event
Open
```

Readable detail sections:

- Wi-Fi connection history
- Audio list
- Bluetooth history
- Time synchronization records
- Power on/off information
- Upload history

### Debug Logs tab

List columns:

```text
Created Time
Received Time
Device SN
Filename
Size
Actions
```

Actions:

- Download
- Delete with confirmation
- Open related API activity

Raw Status/Report JSON frontend par show nahi karna. Backend original payload preserve karega.

---

## 14. API Activity Page

Route:

```text
/api-activity
```

### Live behaviour

- SSE connection se new request activity automatically add ho.
- Live connection state show ho: `LIVE`, `RECONNECTING`, `OFFLINE`.
- Connection break hone par automatic reconnect ho.
- Reconnect ke baad missed events normal API refresh se recover hon.
- New rows ko briefly highlight karo.

### Activity table

```text
Time
Device SN
Method
Endpoint
API Type
HTTP Status
Supplier Code
Response Time
Result
Open
```

Filters:

```text
Device SN
Endpoint
Success/failure
HTTP status
Supplier code
Date/time range
```

### Request detail drawer

Show:

- Request ID
- Received timestamp
- Device SN
- Method and endpoint
- Request headers, sanitized
- Full request payload
- Uploaded file metadata
- Response HTTP status
- Full response payload
- Processing duration
- Error details

Never show:

- Authorization values
- Cookies
- Secret keys
- S3 credentials
- Full binary file content

### Success calculation

Success only when:

```text
HTTP response is successful
AND
supplier response code indicates success
```

Endpoint-specific response structure support karni hogi because OTA response standard `{ code: 0 }` shape use nahi karti.

### Retention

- API activity MongoDB records 30 days preserve hon.
- TTL cleanup backend par implement ho.
- Audit logs TTL use nahi karenge.

---

## 15. Alerts Page

Route:

```text
/alerts
```

Tabs:

```text
Active
Resolved
```

Alert types:

```text
DEVICE_OFFLINE
LOW_BATTERY
LOW_STORAGE
API_FAILED
RECORDING_UPLOAD_FAILED
CONFIGURATION_FAILED
```

Alert table:

```text
Severity
Alert Type
Device SN
Message
Started At
Last Seen At
Status
Open Related Item
```

Rules:

- Device offline: no request for 5 minutes.
- Low battery: battery 20% or below.
- Low storage: free storage 10% or below.
- Condition recover hone par automatically `RESOLVED`.
- Resolved time store karna.
- Historical alert permanently preserve karna unless later retention policy changes.
- Same unresolved condition ke duplicate alerts create nahi karne.

---

## 16. System Health Page

Route:

```text
/system-health
```

Health cards:

```text
Backend API
MongoDB Atlas
Recording Storage
Debug-log Storage
Firmware Storage
Audio Decoder
SSE Live Stream
```

Operational metrics:

```text
Server uptime
Last successful supplier request
Requests in last hour
API failure rate
Average response time
Pending configurations
Failed recordings
Storage usage
Decoder failures
```

Actions:

- Refresh health checks
- Open related failed requests
- Open failed recordings

System restart ya infrastructure mutation actions dashboard mein initially include nahi karne.

---

## 17. Audit Log Page

Route:

```text
/audit-log
```

Every admin management action record karna:

```text
Time
Admin email
Action type
Target type
Target identifier
Old values
New values
Result
IP address, if safely available
```

Audit action examples:

```text
LOGIN_SUCCESS
LOGIN_FAILED
LOGOUT
CONFIG_CREATED
CONFIG_CANCELLED
CONFIG_RETRIED
FIRMWARE_CREATED
FIRMWARE_ACTIVATED
FIRMWARE_DEACTIVATED
FIRMWARE_DOWNGRADE_ACTIVATED
RECORDING_REPROCESS_REQUESTED
DEBUG_LOG_DOWNLOADED
DEBUG_LOG_DELETED
```

Audit history permanently preserve karni hai. Frontend se audit record delete/edit action nahi dena.

---

## 18. Confirmation Rules

### Every configuration submission

Always confirmation required.

### Firmware actions

Confirmation required for:

- Activate rollout
- Replace active firmware
- Force update
- Downgrade
- Deactivate active firmware

### File deletion

Debug-log deletion par confirmation required.

### Recording retry

Simple confirmation required, because new processing attempt create hoga.

### Confirmation button labels

Generic `OK` avoid karna. Action-specific labels use karna:

```text
Confirm and Queue
Activate Firmware
Force Downgrade
Delete Debug Log
Retry Processing
```

---

## 19. Frontend Routes

```text
/login
/overview
/devices
/devices/:sn
/configurations
/firmware
/recordings
/recordings/:sessionId
/logs
/api-activity
/alerts
/system-health
/audit-log
```

Unknown route authenticated user ko `/overview` par redirect kare.

---

## 20. Clean Frontend Folder Structure

Existing React/Vite frontend ko isi simple structure tak extend karna:

Complete project root aur backend folder structure ka canonical source `ZY04-Device-Management-System-Implementation-Plan.md` hai. Neeche ka tree usi root ke `frontend/` folder ko define karta hai.

```text
frontend/
|-- src/
|   |-- main.tsx
|   |-- App.tsx
|   |-- api.ts
|   |-- auth.ts
|   |-- sse.ts
|   |-- types.ts
|   |-- styles.css
|   |
|   |-- components/
|   |   |-- Layout.tsx
|   |   |-- Sidebar.tsx
|   |   |-- Header.tsx
|   |   |-- StatusBadge.tsx
|   |   |-- MetricCard.tsx
|   |   |-- DataTable.tsx
|   |   |-- FilterBar.tsx
|   |   |-- ConfirmModal.tsx
|   |   |-- DetailDrawer.tsx
|   |   |-- AlertCard.tsx
|   |   |-- DeviceHealth.tsx
|   |   |-- AudioPlayer.tsx
|   |   `-- ProcessingTimeline.tsx
|   |
|   `-- pages/
|       |-- Login.tsx
|       |-- Overview.tsx
|       |-- Devices.tsx
|       |-- DeviceDetails.tsx
|       |-- Configurations.tsx
|       |-- Firmware.tsx
|       |-- Recordings.tsx
|       |-- RecordingDetails.tsx
|       |-- DeviceLogs.tsx
|       |-- ApiActivity.tsx
|       |-- Alerts.tsx
|       |-- SystemHealth.tsx
|       `-- AuditLog.tsx
|
|-- package.json
|-- tsconfig.json
|-- vite.config.ts
`-- index.html
```

### Structure rules

- Redux ya another global state library initially add nahi karni.
- Shared HTTP methods `api.ts` mein.
- Authentication helpers `auth.ts` mein.
- SSE connection logic `sse.ts` mein.
- Shared interfaces `types.ts` mein.
- Page-specific small logic same page file mein rahe.
- Reusable component banne par hi `components` mein move karna.
- Har component ke liye separate folder/index file mat banana.
- Unnecessary hooks, stores, contexts aur utility folders create mat karna.
- Existing `RecordingList.tsx` aur `AudioPlayer.tsx` ko reuse/refactor karna.

---

## 21. Frontend API Requirements

Frontend ke liye proposed backend APIs:

### Authentication

```http
POST /api/admin/login
POST /api/admin/logout
GET  /api/admin/session
```

### Overview

```http
GET /api/dashboard/summary
GET /api/dashboard/attention
```

### Devices

```http
GET /api/devices
GET /api/devices/:sn
GET /api/devices/:sn/activity
```

### Configurations

```http
GET  /api/configurations
POST /api/configurations
GET  /api/configurations/:id
POST /api/configurations/:id/cancel
POST /api/configurations/:id/retry
```

### Firmware

```http
GET   /api/firmware
POST  /api/firmware/upload
POST  /api/firmware/url
GET   /api/firmware/:id
POST  /api/firmware/:id/activate
POST  /api/firmware/:id/deactivate
```

### Recordings

```http
GET  /api/recordings
GET  /api/recordings/:sessionId
GET  /api/recordings/:sessionId/audio
GET  /api/recordings/:sessionId/download
GET  /api/recordings/:sessionId/slices/:sliceId/download
POST /api/recordings/:sessionId/retry
```

### Logs

```http
GET    /api/logs/status
GET    /api/logs/report
GET    /api/logs/debug
GET    /api/logs/debug/:id/download
DELETE /api/logs/debug/:id
```

### API Activity

```http
GET /api/api-activity
GET /api/api-activity/:id
GET /api/api-activity/stream
```

### Alerts

```http
GET /api/alerts
```

### System and audit

```http
GET /api/system/health
GET /api/audit-log
```

All list endpoints pagination, search, filters aur sorting support karen.

---

## 22. Loading, Empty and Error States

Har page ke liye:

### Loading

- Table skeleton
- Button loading state
- Duplicate submit disable

### Empty

Examples:

```text
No devices have contacted the server yet.
No pending configurations.
No firmware registered for this model.
No recordings found for the selected filters.
No active alerts.
```

### Error

- Clear human-readable error
- Retry action
- Request ID, if available
- Existing page content unnecessarily clear nahi karna

---

## 23. Responsive Behaviour

- Primary target desktop/laptop browser.
- Tablet par sidebar collapsible ho.
- Small screen par tables horizontal scroll ya compact cards use kar sakti hain.
- Configuration aur firmware management desktop-friendly forms rahen.
- Critical actions small mobile layout par bhi accidental tap se protected hon.

---

## 24. Frontend Build Order

Backend supplier APIs ke phases ke saath frontend incremental banana:

### Phase 1: Foundation

- Login
- Layout
- Sidebar/header
- Protected routes
- Shared table/status/confirmation components

### Phase 2: Overview and Devices

- Overview metrics
- Urgent alerts
- Device list
- Device details health summary
- Separate API tabs

### Phase 3: API Activity

- Activity list
- Full request/response detail
- SSE live updates
- Filters and 30-day history

### Phase 4: Configuration Management

- Configuration list
- Common/Advanced form
- Single/multi-device selection
- Confirmation
- Status tracking
- Cancel/retry actions

### Phase 5: Device Logs

- Status tab
- Report tab
- Debug tab
- Debug download/delete

### Phase 6: Recordings

- Session list
- Expandable slices
- Full processing timeline
- Playback/download/retry

### Phase 7: Firmware / OTA

- Firmware list
- File upload and URL registration
- Model-wide activation
- Force/downgrade confirmation
- OTA visibility

### Phase 8: System and Audit

- Alerts page
- System Health
- Permanent Audit Log

---

## 25. Frontend Definition of Done

- [ ] Admin email/password login works
- [ ] Session expires after 24 hours
- [ ] Problems and urgent alerts appear first on Overview
- [ ] Device becomes offline after 5 minutes without activity
- [ ] Low battery alert triggers at 20% or below
- [ ] Low storage alert triggers at 10% free or below
- [ ] Resolved alerts remain in history
- [ ] Devices needing attention appear first
- [ ] Device detail has separate supplier API tabs
- [ ] API Activity updates live through SSE
- [ ] Full sanitized request and response are visible
- [ ] API Activity expires after 30 days
- [ ] Configurations work for single and multiple devices
- [ ] Common and Advanced settings are separated
- [ ] Every configuration requires confirmation
- [ ] Configuration delivery and acknowledgement are visible
- [ ] Firmware can be added by file upload or URL
- [ ] Model-wide OTA activation works
- [ ] Downgrade requires Advanced mode and confirmation
- [ ] Recording sessions have expandable slices
- [ ] Full processing timeline is visible
- [ ] WAV and original slices can be downloaded
- [ ] Failed recording processing can be retried
- [ ] Status, Report and Debug logs have separate tabs
- [ ] Status and Report payloads have parsed readable views
- [ ] Debug logs can be downloaded and deleted
- [ ] System Health shows backend dependencies
- [ ] Every management action creates a permanent audit record
- [ ] Existing recording functionality remains working

---

## 26. Final Scope Statement

The frontend is an admin operations console, not only a reporting dashboard.

It must support:

```text
MONITOR
  + INSPECT
  + CONFIGURE
  + MANAGE OTA
  + RECOVER FAILED PROCESSING
  + DOWNLOAD FILES
  + AUDIT ADMIN ACTIONS
```

It must not claim to perform direct real-time device commands that the supplier API documentation does not support.
