from flask import Flask, render_template, jsonify
from telemetry.telemetry import get_telemetry, update_telemetry
import cv2

app = Flask(__name__)

@app.route("/")
def dashboard():
    return render_template("dashboard.html")

@app.route("/api/telemetry")
def telemetry():
    return jsonify(get_telemetry())


@app.route("/api/telemetry/test", methods=["POST"])
def test_telemetry():
    update_telemetry(
        connected=True,
        status="NAVIGATING",
        command="FORWARD",
        speed=120,
        distance=3.42,
        front=28,
        left=45,
        right=18,
        rear=60,
        apriltag=True
    )

    return jsonify({
        "success": True,
        "telemetry": get_telemetry()
    })

def generate_frames():
    # Connect this to your DroidCam/OpenCV pipeline later.
    camera = cv2.VideoCapture(2)
    while True:
        ok, frame = camera.read()
        if not ok:
            break
        ok, buffer = cv2.imencode(".jpg", frame)
        if not ok:
            continue
        yield (b"--frame\r\n"
               b"Content-Type: image/jpeg\r\n\r\n" +
               buffer.tobytes() + b"\r\n")
    camera.release()

@app.route("/video_feed")
def video_feed():
    return Response(
        generate_frames(),
        mimetype="multipart/x-mixed-replace; boundary=frame"
    )

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
