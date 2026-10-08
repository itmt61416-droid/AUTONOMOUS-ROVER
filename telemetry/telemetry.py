"""
Central rover telemetry state.

This module stores the latest state of the autonomous rover.
Hardware and simulation code can update this state later.
"""

rover_state = {
    "connected": False,

    "status": "DISCONNECTED",
    "command": "STOP",

    "speed": 0,
    "distance": 0.0,

    "front": 0,
    "left": 0,
    "right": 0,
    "rear": 0,

    "apriltag": False
}


def get_telemetry():
    """Return the current rover telemetry."""
    return rover_state.copy()


def update_telemetry(**values):
    """Update one or more telemetry values."""
    rover_state.update(values)