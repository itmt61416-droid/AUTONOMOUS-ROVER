# Project status

Last updated: 2026-10-08

## Working now

- Flask serves the dashboard and JSON API.
- Shared telemetry schema v1.0 is documented in `API.md`.
- Hardware-free simulator emits telemetry at 2 Hz.
- Dashboard displays mission state, F/L/R/S command, distance, speed, four obstacle readings, line/AprilTag status, chart, and events.
- Mission-level pause/resume/stop controls update simulated mission state.
- Telemetry ingest endpoint validates incoming snapshots.

## Current milestone

**Complete the simulated end-to-end slice; next connect a real laptop bridge.** The simulator and hardware producer are mutually exclusive by source: while the controller currently holds simulator data, ingest is accepted and replaces it with the real source. Turn off automatic simulation with `ROVER_SIMULATOR=0` for real integration.

## Shared decisions

- OpenCV/laptop chooses F/L/R/S.
- ESP32 is the motor, emergency-stop, and immediate obstacle-safety authority.
- Flask is mission control and telemetry transport.
- Browser is a dashboard with mission-level controls; it is not the steering brain.
- Telemetry schema changes require an API doc update in the same PR.

## Next tasks and ownership

| Priority | Task | Suggested owner | Status |
|---|---|---|---|
| 1 | Confirm ESP32 connection choice and exact serial/Wi-Fi message format | Rover integration owner | Todo |
| 2 | Build laptop bridge for ESP32 + vision data → v1.0 telemetry POST | Rover integration owner | Todo |
| 3 | Connect camera stream to the existing vision panel | Frontend + vision owners | Todo |
| 4 | Exercise link-loss, E-stop, and obstacle stops with wheels lifted | Hardware owner | Todo |
| 5 | Review mobile layout and event/message wording | Frontend teammate | In progress |

Replace role labels with teammate names together. Keep one task in progress per person and update this file when work moves to review or is merged.

## Git coordination

Use short feature branches and PRs into `main`. Frontend changes live in `templates/` and `static/`; integration changes live in `app.py` and `rover/`. Both people pull `main` before branching. Coordinate edits to `docs/API.md` and update the status table when a feature lands. `main` should always start locally.
