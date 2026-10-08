"""Flask bridge for the Syntax Squad rover dashboard and ESP32."""
from __future__ import annotations

import base64
import os
import threading
import time
from copy import deepcopy
from typing import Any

from flask import Flask, Response, jsonify, render_template, request

app = Flask(__name__)
LOCK = threading.RLock()
MOCK_TELEMETRY = os.getenv("ROVER_MOCK_TELEMETRY", "1").lower() not in {"0", "false", "no"}
TELEMETRY_TIMEOUT = float(os.getenv("ROVER_TELEMETRY_TIMEOUT", "3"))

state: dict[str, Any] = {
    "mode": "AUTO", "command": "S", "mission": {"status": "READY", "x": 8.0, "y": 8.0},
    "telemetry": {
        "online": True, "mode": "AUTO", "command": "S", "speed": 0, "distance": 0,
        "ultrasonic": {"front": 82.4, "left": 65.1, "right": 91.0, "rear": 110.0},
        "ir": {"left": 0, "center": 0, "right": 0, "path": "STRAIGHT"},
        "encoder": {"left": 0, "right": 0}, "mpu": {"heading": 0, "orientation": "NORTH"},
        "apriltag": {"detected": False, "id": None},
        "navigation": {"stage": "START", "status": "READY", "obstacleState": "PATH CLEAR", "courseCorrection": "NOT ACTIVE"},
        "safety": {"status": "CLEAR"}, "movement": "STOP",
    },
    "telemetry_at": time.monotonic(), "command_seq": 0,
}

ALLOWED_COMMANDS = {"F", "B", "L", "R", "S"}


def error(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


def json_body():
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else None


def snapshot() -> dict[str, Any]:
    with LOCK:
        data = deepcopy(state["telemetry"])
        data["mode"] = state["mode"]
        data["command"] = state["command"]
        data["mission"] = deepcopy(state["mission"])
        data["online"] = MOCK_TELEMETRY or time.monotonic() - state["telemetry_at"] <= TELEMETRY_TIMEOUT
        return data


@app.get("/")
def dashboard():
    return render_template("dashboard.html")


@app.get("/api/telemetry")
def get_telemetry():
    return jsonify(snapshot())


@app.post("/api/telemetry/update")
def update_telemetry():
    """ESP32 push endpoint. Accepts the dashboard's nested format or flat sensor values."""
    body = json_body()
    if body is None:
        return error("Expected a JSON object")
    with LOCK:
        merged = deepcopy(state["telemetry"])
        for key in ("speed", "distance", "movement", "stage", "status", "path", "pathDecision",
                    "heading", "orientation", "encoderLeft", "encoderRight", "tagDetected",
                    "apriltagDetected", "apriltagId", "tagId", "obstacleState", "courseCorrection",
                    "navigationStage", "navigationStatus", "safetyStatus"):
            if key in body:
                merged[key] = body[key]
        for group in ("ultrasonic", "sensors", "ir", "encoder", "mpu", "orientation", "apriltag", "aprilTag", "navigation", "safety"):
            if isinstance(body.get(group), dict):
                existing_key = group
                if group in {"sensors", "aprilTag", "orientation"}:
                    existing_key = {"sensors": "ultrasonic", "aprilTag": "apriltag", "orientation": "mpu"}[group]
                merged[existing_key] = {**merged.get(existing_key, {}), **body[group]}
        flat_to_group = {"front": ("ultrasonic", "front"), "left": ("ultrasonic", "left"),
                         "right": ("ultrasonic", "right"), "rear": ("ultrasonic", "rear"),
                         "irLeft": ("ir", "left"), "irCenter": ("ir", "center"), "irRight": ("ir", "right")}
        for key, (group, field) in flat_to_group.items():
            if key in body:
                merged.setdefault(group, {})[field] = body[key]
        state["telemetry"] = merged
        state["telemetry_at"] = time.monotonic()
    return jsonify({"ok": True, "online": True})


@app.post("/api/mission")
def mission():
    body = json_body()
    if body is None:
        return error("Expected a JSON object")
    action = body.get("action")
    if action == "set_destination":
        x, y = body.get("x"), body.get("y")
        if not valid_coordinate(x) or not valid_coordinate(y):
            return error("x and y must be numbers between 0 and 10")
        with LOCK:
            state["mission"].update(status="READY", x=float(x), y=float(y))
        return jsonify({"ok": True, "mission": deepcopy(state["mission"])})
    if action == "start":
        x, y = body.get("x"), body.get("y")
        with LOCK:
            if state["mode"] != "AUTO":
                return error("Switch to AUTO mode before starting a mission", 409)
            if x is not None and y is not None:
                if not valid_coordinate(x) or not valid_coordinate(y):
                    return error("x and y must be numbers between 0 and 10")
                state["mission"].update(x=float(x), y=float(y))
            state["mission"]["status"] = "RUNNING"
            state["command"] = "S"
            state["command_seq"] += 1
            result = deepcopy(state["mission"])
        return jsonify({"ok": True, "mission": result})
    if action == "stop":
        with LOCK:
            state["mission"]["status"] = "STOPPED"
            state["command"] = "S"
            state["command_seq"] += 1
            result = deepcopy(state["mission"])
        return jsonify({"ok": True, "mission": result})
    return error("action must be set_destination, start, or stop")


def valid_coordinate(value: Any) -> bool:
    try:
        number = float(value)
        return 0 <= number <= 10 and number == number
    except (TypeError, ValueError):
        return False


@app.post("/api/mode")
def set_mode():
    body = json_body()
    mode = str((body or {}).get("mode", "")).upper()
    if mode not in {"AUTO", "MANUAL"}:
        return error("mode must be AUTO or MANUAL")
    with LOCK:
        state["mode"] = mode
        state["command"] = "S"
        state["command_seq"] += 1
        if mode == "MANUAL" and state["mission"]["status"] == "RUNNING":
            state["mission"]["status"] = "STOPPED"
    return jsonify({"ok": True, "mode": mode, "command": "S"})


@app.post("/api/control")
def control():
    body = json_body()
    if body is None:
        return error("Expected a JSON object")
    command = str(body.get("command", "")).upper()
    mode = str(body.get("mode", "")).upper()
    if command not in ALLOWED_COMMANDS:
        return error("command must be F, B, L, R, or S")
    with LOCK:
        if command != "S" and (state["mode"] != "MANUAL" or mode != "MANUAL"):
            return error("Movement commands require MANUAL mode", 409)
        state["command"] = command
        state["command_seq"] += 1
        if command != "S":
            state["mission"]["status"] = "STOPPED"
    return jsonify({"ok": True, "command": command, "mode": state["mode"]})


@app.get("/api/esp32/command")
def esp32_command():
    """ESP32 polls this endpoint; command_seq lets it ignore duplicate polls."""
    with LOCK:
        result = {"seq": state["command_seq"], "mode": state["mode"], "command": state["command"],
                  "mission": deepcopy(state["mission"])}
    return jsonify(result)


# Valid one-pixel JPEG; the route remains usable without a camera or OpenCV.
PLACEHOLDER_JPEG = base64.b64decode("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=")


@app.get("/video_feed")
def video_feed():
    def frames():
        camera = None
        cv2 = None
        camera_index = os.getenv("ROVER_CAMERA_INDEX")
        if camera_index is not None:
            try:
                import cv2 as cv_module
                cv2 = cv_module
                camera = cv2.VideoCapture(int(camera_index))
            except (ImportError, ValueError):
                camera = None
        while True:
            frame = PLACEHOLDER_JPEG
            if camera is not None and camera.isOpened():
                ok, image = camera.read()
                if ok:
                    encoded, buffer = cv2.imencode(".jpg", image)
                    if encoded:
                        frame = buffer.tobytes()
            yield b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(frame)).encode() + b"\r\n\r\n" + frame + b"\r\n"
            time.sleep(0.5)
    return Response(frames(), mimetype="multipart/x-mixed-replace; boundary=frame", headers={"Cache-Control": "no-store"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), threaded=True, debug=False)
