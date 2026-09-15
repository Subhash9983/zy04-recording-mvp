# Device API Documentation

## Supported Configuration Distribution List

| Key | Type | Description | Default |
| --- | --- | --- | --- |
| `record_mode` | int | Record mode: `0` = Normal, `1` = Wearer Only | `0` |
| `record_time` | int | Segment duration, `600`-`7200` seconds | `7200` |
| `record_ignore_time` | int | Minimum valid recording duration, `0`-`600` seconds | `10` |
| `retry_delay` | int | Badge automatic retry-upload interval during shutdown, in seconds | `0` |
| `duor` | int | No upload during recording: `1` = On, `0` = Off | `0` |
| `no_switch` | int | Disable switch. When enabled, the badge starts recording immediately after being unplugged from the charger and stops recording when plugged into the charger. `1` = On, `0` = Off | `0` |
| `domain` | string | Recording upload domain | `cw.gdszzy.com` |
| `domain_apm` | string | Report log, debug log, and status log upload domain | `cw.gdszzy.com` |
| `domain_config` | string | OTA, time sync, and configuration pull domain | `cw.gdszzy.com` |
| `s3_config` | string | S3-compatible direct-upload configuration. Format: `host,service,region,secretId,secretKey,key-template` | Empty |
| `s3_callback` | int | Enable S3 callback. Supported in Wi-Fi badge firmware `3.2.40+` and dual-mode badge firmware `4.0.23+`. `1` = On, `0` = Off | `0` |
| `snapshot_status` | int | Report status on segmentation. Supported in dual-mode badge firmware `4.0.26+`. `1` = On, `0` = Off | `0` |
| `tz` | string | Timezone following the glibc timezone standard. Example for China time: `UTC-8` | `UTC-8` |
| `compress` | string | Compression. Currently only LZ4 is supported. Supported in badge firmware `3.2.37+`. `lz4` = On, empty string = Off | Empty |
| `disable_tls` | int | Disable TLS. When disabled, all API requests use HTTP. `1` = On, `0` = Off | `0` |
| `http_proxy` | string | HTTP proxy | Empty |
| `extra_headers` | string | Extra HTTP headers, one per line, formatted as `Header-Key:Header-Value` | Empty |
| `modem_apn` | string | Mobile-network APN. Examples: China Mobile `cmnet`; China Unicom `3gnet` or `scuiot`; China Telecom `ctnet` | Empty |
| `preferred_network` | string | Preferred network. Supported in dual-mode badge firmware `4.0.29+`: `wifi`, `lte`, `only_wifi`, or `only_lte` | `wifi` |

### S3 Configuration Notes

- `host`: Bucket root-directory URL without the `https://` prefix.
- `service`: Bucket type, such as `s3` for Amazon, `cos` for Tencent, or `oss` for Alibaba.
- `region`: For example, `ap-northeast-1`.
- `key-template` / prefix: Object key. Its format is described in the [S3 callback documentation](https://cw-docs.gdszzy.com/en/direct-upload/s3-callback).
- Example: `test.cos.ap-guangzhou.myqcloud.com,cos,ap-guangzhou,secretId,secretKey,/test/`
- When S3 uploading is configured, recordings ignore `domain` and upload directly to the specified host through the S3 protocol.
- When S3 uploading is used, the badge no longer calls the `recordUpload` interface.

## Configuration APIs

### Badge Time Sync

`GET /sca/device/cloud_time`

Returns the server time. The request has no body.

#### Response

```json
{
  "code": 0,
  "data": {
    "create_time": 1767594238886
  }
}
```

- `code`: `0` means success; any non-zero value means failure.
- `create_time`: Server time as a 13-digit Unix timestamp in milliseconds.

### Badge Fetch Configuration

`POST /sca/device/config`

Fetches the configuration list from the server.

#### Request

```json
{
  "product": "SA01A1",
  "sn": "4S1006EC4281800450",
  "version": "2.2.32.16"
}
```

#### Response

```json
{
  "code": 0,
  "data": {
    "session_id": 492,
    "device_model": "SA01A1",
    "domain": "example.com",
    "record_time": 3600
  }
}
```

- Return `code: 0` when a configuration needs to be delivered. In this case, `data` must contain the configuration.
- Return a non-zero `code` when no configuration needs to be delivered.
- `session_id`: Unique identifier for this configuration delivery.
- `device_model`: Device model.
- Remaining key-value pairs are configuration values sent to the badge.

### Badge Respond to Configuration

`POST /sca/device/config_status`

The badge acknowledges the configuration fetched from the server.

#### Request

```json
{
  "sn": "4S1006EC4281800450",
  "session_id": "492",
  "status": "success"
}
```

- When `status` is `success`, the backend should mark this configuration as fetched.
- Subsequent configuration requests must not return the same configuration again.

#### Response

```json
{
  "code": 0
}
```

### Query OTA

`POST /ota/v1/fetch_new_firmware`

Checks whether newer or forced firmware is available for the badge.

#### Request

```json
{
  "sn": "4S1006EC4281800450",
  "device_model": "SA01A1",
  "fetch_firmware": [
    {
      "firmware_type": "dsp",
      "firmware_version": "1.0.15"
    },
    {
      "firmware_type": "esp",
      "firmware_version": "2.2.32"
    }
  ]
}
```

#### Response

```json
{
  "sn": "4S1006EC4281800450",
  "device_model": "SA01A1",
  "current_firmware": [
    {
      "firmware_version": "1.0.15",
      "firmware_type": "dsp"
    },
    {
      "firmware_version": "2.2.32",
      "firmware_type": "esp"
    }
  ],
  "latest_firmware": [
    {
      "firmware_version": "1.0.16",
      "firmware_type": "dsp",
      "url": "https://example.com/xxx.bin",
      "md5": "7fb0b64ce5caafe30c61b0ad60f1a3d0",
      "update_type": "force"
    },
    {
      "firmware_version": "2.2.33",
      "firmware_type": "esp",
      "url": "https://example.com/yyy.bin",
      "md5": "78e503f18619df840ab64a0ac6dc0dd8",
      "update_type": "force"
    }
  ]
}
```

- `current_firmware`: Echoes the firmware versions reported by the badge.
- `latest_firmware`: Lists firmware packages available for upgrade.
- `url`: Download URL for the firmware binary.
- `md5`: MD5 checksum used to verify the downloaded firmware file.
- `update_type: force`: Forces the upgrade and may also be used for a downgrade. For a non-forced update, the badge compares versions locally.

## Log Interface APIs

### Report Log Upload

`POST /sca/device/reportinfo`

The device uses this endpoint to upload report logs and status logs.

#### Request Structure

```json
{
  "common": {
    "product": "SA01A1",
    "sn": "4S1006EC4281800450",
    "esp_version": "2.2.32",
    "dsp_version": "1.0.16"
  },
  "dev_info": {
    "status": {}
  }
}
```

- `common.product`: Product name.
- `common.sn`: Device serial number.
- `common.esp_version`: ESP firmware version.
- `common.dsp_version`: DSP firmware version.
- If `dev_info.status` exists, the payload is a status log.

#### Response

```json
{
  "code": 0
}
```

#### Report Log Content Example

```json
{
  "dev_info": {
    "wifi_history": [
      {
        "ts": 1767334630716,
        "gw": "192.168.1.1",
        "ip": "192.168.1.43",
        "netmask": "255.255.255.0",
        "result": "ok",
        "rssi": -92,
        "ssid": "WiFi-SSID"
      },
      {
        "ts": 1767334630716,
        "result": "fail",
        "ssid": "WiFi-SSID"
      }
    ],
    "audio_list": [
      {
        "audio_id": "A11222101718_2.2.32.16_20260102141702984_PEYz9R7z"
      },
      {
        "audio_id": "A11222101718_2.2.32.16_20260102142702984_PEYz9R7z"
      },
      {
        "audio_id": "A11222101718_2.2.32.16_20260102143702984_PEYz9R7z"
      }
    ],
    "ble_history": [
      {
        "start_ts": 1767334630716,
        "stop_ts": 1767334630716,
        "connect_ts": 1767334630716
      }
    ],
    "oper_history": {
      "date_record": [
        {
          "server": 1767334632889,
          "local": 1767335334641,
          "offset": -701752
        }
      ],
      "duration": 1773,
      "power_off": {
        "ts": 1767336392273,
        "power": 20,
        "reason": "key"
      },
      "power_on": {
        "power": 50,
        "reason": "key",
        "ts": 1767334618851
      }
    },
    "upload_history": [
      {
        "filename": "A11222101718_2.2.32.16_20260102141702984_PEYz9R7z",
        "size": 1024,
        "cost": 13260,
        "speed": 135,
        "record_ts": 1767334618851,
        "upload_ts": 1767334618851,
        "mode": 0,
        "result": "success"
      }
    ]
  }
}
```

##### Report Log Fields

- `wifi_history`: Network connection history.
  - `ts`: Connection time as a 13-digit timestamp.
  - `gw`: Gateway address.
  - `ip`: Assigned IP address.
  - `netmask`: Network mask.
  - `result`: Connection result, such as `ok` or `fail`.
  - `rssi`: Wi-Fi signal strength. A value closer to `0` indicates a stronger signal.
  - `ssid`: Wi-Fi network name.
- `audio_list`: Recording segments generated during recording.
- `ble_history`: Bluetooth activity history.
  - `start_ts`: Bluetooth start time.
  - `stop_ts`: Bluetooth end time.
  - `connect_ts`: Present when Bluetooth connected successfully.
- `oper_history`: Device operation history.
  - `date_record`: Time-synchronization records containing server time, local time, and calculated offset.
  - `duration`: Device working duration.
  - `power_on`: Power-on timestamp, battery level, and reason.
  - `power_off`: Power-off timestamp, battery level, and reason.
- `upload_history`: Recording upload history.
  - `size`: File size in bytes.
  - `cost`: Upload duration in milliseconds.
  - `speed`: Upload speed in KB/s.
  - `record_ts`: Recording creation time.
  - `upload_ts`: Upload time.
  - `mode`: Recording mode.
  - `result`: Upload result, `success` or `fail`.

#### Status Log Content Example

```json
{
  "dev_info": {
    "local_files": [
      {
        "filename": "A14284503126_3.2.32.16_20260104170436646_gAFiFp3d",
        "record_ts": 1767517476646,
        "size": 32000
      }
    ],
    "status": {
      "debug_count": 1,
      "storage_space": 7816216576,
      "free_space": 7813890048,
      "used_space": 2326528,
      "hub": {
        "sn": "HUB2502130004"
      },
      "power": 100,
      "report_count": 2,
      "wifi": {
        "rssi": -89,
        "ssid": "WiFi-SSID"
      },
      "current": 5
    }
  }
}
```

##### Status Log Fields

- `local_files`: Recording files currently stored on the device.
  - `filename`: Local recording filename.
  - `record_ts`: Recording creation time.
  - `size`: File size in bytes.
- `status`: Real-time device status.
  - `debug_count`: Number of debug files.
  - `storage_space`: Total storage capacity in bytes.
  - `free_space`: Available storage in bytes.
  - `used_space`: Used storage in bytes.
  - `hub.sn`: Hub serial number. Present when the device uploads through a hub.
  - `power`: Battery percentage.
  - `report_count`: Number of report files.
  - `wifi`: Present when the device is connected through Wi-Fi.
  - `current`: Current device operating state.

#### Power-on Reason Values

| Value | Meaning |
| --- | --- |
| `key` | Switch |
| `charge` | Powered on because charging started |
| `timer` | Scheduled retry upload during shutdown |
| `charge_timer` | Scheduled retry upload while charging |
| `autoUpload` | Automatic upload after shutdown |

#### Power-off Reason Values

| Value | Meaning |
| --- | --- |
| `key` | Switch |
| `charge` | Powered off because charging started |
| `sleep` | Sleep during charging |
| `uncharge` | Charging ended |
| `fullyCharged` | Sleep after becoming fully charged |

#### Current Device State Values

| Value | Meaning |
| --- | --- |
| `1` | Charging |
| `2` | Charging auto retry |
| `3` | USB mode |
| `5` | Recording |
| `6` | Auto retry during shutdown |
| `8` | Auto upload after shutdown |

### Debug Log Upload

`POST /sca/device/debug_log`

Content type: `multipart/form-data`

Uploads a device debug-log file.

#### Form-data Request

| Key | Type | Description |
| --- | --- | --- |
| `sn` | string | Badge serial number |
| `ts` | string | Log creation time as a 13-digit timestamp |
| `log_file` | file | Debug-log file |
| ~~`create_time`~~ | ~~string~~ | ~~Deprecated log creation time in `YYYYMMDDHHmmss` format~~ |

#### Response

```json
{
  "code": 0
}
```

## Record Interface APIs

### Recording Upload

`POST /sca/recordupload`

Content type: `multipart/form-data`

Uploads a recording slice from the badge.

#### Form-data Request

| Key | Type | Description |
| --- | --- | --- |
| `sn` | string | Badge serial number |
| `esp_version` | string | ESP firmware version |
| `dsp_version` | string | DSP firmware version |
| `file_name` | string | Recording filename |
| `mac` | string | Wi-Fi MAC address |
| `session_id` | string | Recording session identifier. All slices recorded during the same power cycle share one session ID. |
| `create_time` | string | Slice creation time as a 13-digit timestamp |
| `duration` | string | Slice duration in milliseconds |
| `audio_type` | string | Audio type: `OPUS` |
| `channel` | string | Audio channel layout: `STEREO` |
| `sample_rate` | string | Audio sample rate: `16000` Hz |
| `frame_size_ms` | string | Frame size: `20` milliseconds. For compatibility, the server defaults this field to `20` when omitted. |
| `frame_rate` | string | Frame rate: `8`. For compatibility, the server defaults this field to `8` when omitted. |
| `sig_type` | string | Signal type: `2`. For compatibility, the server defaults this field to `2` when omitted. |
| `compress` | string | Set to `lz4` for a compressed upload. Omit this field for an uncompressed upload. |
| `record_file` | file | Recording slice file |
| `serial` | string | Unsigned 32-bit recording-slice sequence value. The high 16 bits contain flags and the low 16 bits contain the slice number. |

#### Recording Slice Serial Format

The `serial` value starts at slice number `1` and is represented as an unsigned 32-bit numeric string:

- High 16 bits: Marker flags.
- Low 16 bits: Slice sequence number.
- End-of-recording marker: `0x0001` in the high 16 bits.
- A slice is considered the final slice when its `serial` contains the end marker.

For a recording containing three slices:

| Slice | Serial value | Meaning |
| --- | --- | --- |
| 1 | `0x00000001` | Slice number 1 |
| 2 | `0x00000002` | Slice number 2 |
| 3 | `0x00010003` | Final slice: `(0x0001 << 16) \| 3` |

#### Response

```json
{
  "code": 0,
  "data": {
    "record_id": ""
  }
}
```

- `code`: `0` indicates that the upload was accepted successfully.
- `record_id`: Unique recording identifier generated by the server.

### Recording Decoding

Recording files uploaded by the badge are non-standard Opus files. They must be decoded to WAV before they can be used by standard audio-processing tools.

Use the vendor-provided [opus-decoder-core](https://github.com/Gdszzy/opus-decoder-core) decoding library.

## Documentation Status

This file currently contains the **Config Interface**, **Log Interface**, and **Record Interface** documentation supplied so far. System-level interpretation, backend design, database schema, and implementation decisions will be added after the remaining API documentation is provided.
