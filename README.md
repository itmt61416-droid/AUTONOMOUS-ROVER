# Rover Mission Control

A small, GitHub-ready Flask dashboard for the autonomous rover. The first vertical slice runs without hardware: a telemetry simulator feeds a shared JSON contract, Flask serves that contract, and the dashboard renders live state, sensors, a distance chart, and system events.

## Architecture and authority

```text
Phone camera → OpenCV vision on laptop → F / L / R / S decision → ESP32 → motors
                                                                  │
                                  sensors / encoders telemetry ───┘
                                             ↓
                                      Flask mission control → browser dashboard
```

- **Vision/laptop** detects the line and AprilTags and selects F/L/R/S.
- **ESP32** remains the authority for motor actuation, emergency stop, and immediate obstacle safety.
- **Flask** transports, validates, and presents telemetry. The browser sends only mission-level start, pause, resume, and stop actions.
- **Dashboard** visualizes state; it does not decide steering or bypass ESP32 safety.

The initial controller is deliberately a software boundary. Do not connect browser buttons directly to motor pins. Add and review the laptop-to-ESP32 adapter only after the physical stop and obstacle behavior have been tested.

## Run locally (Windows PowerShell)

```powershell
cd rover-dashboard
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

Open <http://127.0.0.1:5000>. The simulator starts automatically and publishes new samples twice per second. No camera or rover is required. Stop the server with Ctrl+C.

To run Flask without automatic simulation, set `ROVER_SIMULATOR=0` before starting; post `{"enabled":true}` to `/api/v1/simulator` when you want to resume it. This is useful when a real telemetry bridge is ready.

## Current API

See [docs/API.md](docs/API.md) for the canonical contract, endpoints, examples, and validation rules. Dashboard implementation belongs in `templates/` and `static/`; API and integration logic belongs in `app.py` and `rover/`.

## Team split

- **Frontend teammate:** `templates/`, `static/`; consume only documented `/api/v1` endpoints. Keep dashboard-only changes in a `feat/dashboard-...` branch.
- **Integration/backend owner:** `app.py`, `rover/`, API contract changes in `docs/API.md`; use `feat/telemetry-...` or `feat/esp32-...` branches.
- **Shared:** `README.md`, `docs/PROJECT_STATUS.md`, and this workflow. Update status when a feature is merged or its owner changes.

## GitHub workflow (both teammates)

1. One teammate creates the GitHub repository and pushes this folder as the initial `main` branch. Add the other teammate as a collaborator.
2. Keep `main` runnable. Before starting work: `git switch main`, `git pull`, then `git switch -c feat/short-task-name`.
3. Commit a focused change with a clear message, for example `feat: render live obstacle telemetry`.
4. Push the branch: `git push -u origin feat/short-task-name`; open a Pull Request into `main` and describe the visible behavior and any API change.
5. The other teammate reviews the diff and confirms the documented contract still matches. Merge the PR, then both teammates pull `main` before starting the next task.
6. Avoid working simultaneously in the same files. If an API change is needed, agree on the contract first and update `docs/API.md` in the same PR.

Never commit `.venv/`, secrets, camera credentials, or local machine configuration. Use `git status` before committing and pull before pushing. Do not force-push shared branches.

## Next integration milestones

1. Agree on the actual ESP32 telemetry transport (USB serial or Wi-Fi) and its message format.
2. Implement a laptop-side bridge/adapter that converts ESP32 and OpenCV readings into the schema in `docs/API.md`, then posts `/api/v1/telemetry`.
3. Add real camera frames using a dedicated stream endpoint; keep image transport separate from the small telemetry JSON.
4. Validate physical E-stop, link-loss stop, and obstacle behavior on the ESP32 before any powered rover test.

See [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) for ownership and the current checklist.
