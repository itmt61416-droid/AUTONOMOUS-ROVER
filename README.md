# Rover dashboard backend

This Flask app serves the supplied dashboard at `/`, serves its camera element at `/video_feed`, and exposes the API used by the supplied `dashboard.js`. The uploaded HTML and JavaScript are copied without frontend logic changes. The upload did not include `static/css/style.css`, which the HTML references; the page still loads, but that stylesheet must be supplied for the friend's intended styling.

## Start it

```powershell
py -m pip install -r requirements.txt
py app.py
```

Open `http://localhost:5000`. To open it from a phone or another computer on the same Wi-Fi, use the laptop's LAN IP and allow Python through the private-network firewall. Mock telemetry is on by default. To use real ESP32 telemetry, set `ROVER_MOCK_TELEMETRY=0` before starting Flask. The browser reports the rover offline after three seconds without an ESP32 update (`ROVER_TELEMETRY_TIMEOUT` can change this). `/video_feed` displays a placeholder until a camera index is configured; install `opencv-python` and set `ROVER_CAMERA_INDEX=0` to use a camera available to the Flask host.

## Frontend contract

The supplied JavaScript calls these endpoints on the same origin. For POST requests it sends `Content-Type: application/json`; it only checks HTTP success and does not read the response body.

| Method and path | Request JSON | Response JSON / behavior |
|---|---|---|
| `GET /api/telemetry` | none | Telemetry object documented below. `online` controls the dashboard connection indicator. |
| `POST /api/mission` | `{ "action": "set_destination", "x": 0..10, "y": 0..10 }` | `{ "ok": true, "mission": { "status": "READY", "x": number, "y": number } }` |
| `POST /api/mission` | `{ "action": "start", "x": 0..10, "y": 0..10 }` | Sets mission to RUNNING in AUTO mode; returns `{ "ok": true, "mission": { ... } }`. Coordinates are optional if already set. |
| `POST /api/mission` | `{ "action": "stop" }` | Stops mission and sets command to S; returns `{ "ok": true, "mission": { ... } }`. |
| `POST /api/mode` | `{ "mode": "AUTO" }` or `{ "mode": "MANUAL" }` | `{ "ok": true, "mode": "AUTO"|"MANUAL", "command": "S" }`; changing mode always stops movement. |
| `POST /api/control` | `{ "command": "F"|"B"|"L"|"R"|"S", "mode": "MANUAL" }` | `{ "ok": true, "command": "...", "mode": "MANUAL" }`. Non-stop movement is rejected unless manual mode is active. |
| `GET /video_feed` | none | MJPEG multipart stream used by the HTML `<img>`. Placeholder by default; live host camera is optional as described above. |

All invalid requests return `{ "ok": false, "error": "reason" }` with a 4xx status. The dashboard only checks success status for its POST requests.

### Telemetry shape

```json
{
  "online": true,
  "mode": "AUTO",
  "command": "S",
  "speed": 0,
  "distance": 0,
  "ultrasonic": { "front": 82.4, "left": 65.1, "right": 91, "rear": 110 },
  "ir": { "left": 0, "center": 0, "right": 0, "path": "STRAIGHT" },
  "encoder": { "left": 0, "right": 0 },
  "mpu": { "heading": 0, "orientation": "NORTH" },
  "apriltag": { "detected": false, "id": null },
  "navigation": { "stage": "START", "status": "READY", "obstacleState": "PATH CLEAR", "courseCorrection": "NOT ACTIVE" },
  "safety": { "status": "CLEAR" },
  "movement": "STOP",
  "mission": { "status": "READY", "x": 8, "y": 8 }
}
```

The dashboard also accepts common aliases (`sensors` for `ultrasonic`, `orientation` for `mpu`, `aprilTag` for `apriltag`) and flat distance/sensor values. ESP32 updates may use either nested groups or flat `front`, `left`, `right`, `rear`, `irLeft`, `irCenter`, and `irRight` values.

## ESP32 interface

1. Push a telemetry JSON object every 250–1000 ms to `POST http://<laptop-ip>:5000/api/telemetry/update`.
2. Poll `GET http://<laptop-ip>:5000/api/esp32/command` every 100–200 ms. Response: `{ "seq": 12, "mode": "MANUAL", "command": "F", "mission": { "status": "STOPPED", "x": 8, "y": 8 } }`.
3. Act only on a new `seq`. Apply a short motor command lease (for example, stop if no fresh command arrives for 500 ms), honor `S` immediately, and retain ESP32 obstacle/emergency-stop interlocks. The Flask process does not directly drive GPIO or motors.

The ESP32 and laptop must be on the same reachable network. Use the laptop's LAN IP, not `localhost`, in ESP32 firmware. Commands and mission coordinates are currently process-memory state and reset when Flask restarts; this is appropriate for integration but not persistent mission storage.

## Combination sequence

1. Start Flask with mock telemetry and open the dashboard. Confirm live values, `CONNECTED`, and that the page polls without errors.
2. Use AUTO mode, set a waypoint, start, then stop. Confirm the mission endpoint accepts each action and the ESP32 command endpoint reports the new state/sequence.
3. Switch to MANUAL, test each direction briefly with wheels raised, and confirm releasing a button sends `S`. Verify AUTO mode rejects motion and the ESP32 hardware stop remains authoritative.
4. Set `ROVER_MOCK_TELEMETRY=0`; post a sample JSON payload to `/api/telemetry/update` and confirm the dashboard updates and remains online.
5. Replace sample updates with actual ultrasonic, encoder, IR, IMU, and tag values. Then point ESP32 command polling at `/api/esp32/command` and connect motor commands only after the raised-wheel stop test passes.
6. Configure `ROVER_CAMERA_INDEX` if the Flask host has a camera, or have the ESP32/vision computer publish frames through a future camera adapter. The current REST API does not transmit camera frames.
