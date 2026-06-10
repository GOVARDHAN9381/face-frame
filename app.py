# ============================================================
#  app.py  –  Flask REST API Backend
#  SpectAI – AI Spectacle Recommendation System
#
#  Endpoints:
#    POST /upload        – Upload image (multipart)
#    POST /analyze       – Upload + analyze in one shot
#    GET  /results/<id>  – Retrieve stored scan
#    POST /sendtoesp32   – Forward results to ESP32
#    GET  /history       – All scan history
#    GET  /stats         – Admin analytics
#    GET  /health        – Health check
# ============================================================

import os
import uuid
import json
import requests
import traceback
from datetime import datetime
from pathlib import Path

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

from face_analyzer   import FaceAnalyzer
from recommender     import recommend, recommendation_to_dict
from database        import save_scan, get_scan, get_all_scans, log_esp32, get_stats

# ── Config ────────────────────────────────────────────────
ESP32_IP   = os.environ.get("ESP32_IP",   "192.168.1.100")   # ← change to your ESP32 IP
ESP32_PORT = int(os.environ.get("ESP32_PORT", 80))
UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

MAX_FILE_MB = 10

app      = Flask(__name__, static_folder=".", static_url_path="")
CORS(app, resources={r"/*": {"origins": "*"}})

analyzer = FaceAnalyzer()   # load MediaPipe once


# ── Static Frontend ───────────────────────────────────────
@app.route("/")
def root():
    return send_from_directory(".", "index.html")


# ── Health Check ──────────────────────────────────────────
@app.route("/health")
def health():
    return jsonify({"status": "ok", "version": "1.0.0", "timestamp": datetime.utcnow().isoformat()})


# ── /upload  (store image, return file ID) ────────────────
@app.route("/upload", methods=["POST"])
def upload():
    if "image" not in request.files:
        return jsonify({"error": "No image field in request"}), 400

    file = request.files["image"]
    if file.filename == "":
        return jsonify({"error": "Empty filename"}), 400

    # Size guard
    file.seek(0, 2)
    size = file.tell()
    file.seek(0)
    if size > MAX_FILE_MB * 1024 * 1024:
        return jsonify({"error": f"File too large (max {MAX_FILE_MB} MB)"}), 413

    file_id = uuid.uuid4().hex
    ext     = Path(file.filename).suffix or ".jpg"
    path    = UPLOAD_DIR / f"{file_id}{ext}"
    file.save(str(path))

    return jsonify({"file_id": file_id, "path": str(path)}), 200


# ── /analyze  (upload + analyze in one call) ─────────────
@app.route("/analyze", methods=["POST"])
def analyze():
    if "image" not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    file = request.files["image"]
    img_bytes = file.read()

    if len(img_bytes) == 0:
        return jsonify({"error": "Empty file"}), 400

    try:
        # ── 1. Face analysis ──
        measurements = analyzer.analyze(img_bytes)

        # ── 2. Frame recommendation ──
        rec = recommend(
            face_shape    = measurements["face_shape"],
            face_width_mm = measurements["face_width"],
            pd_mm         = measurements.get("pd")
        )
        rec_dict = recommendation_to_dict(rec)

        # ── 3. Build full result ──
        scan_id = "SCAN-" + uuid.uuid4().hex[:8].upper()
        result  = {
            "scan_id":   scan_id,
            "timestamp": datetime.utcnow().isoformat(),
            **measurements,
            **rec_dict,
        }

        # ── 4. Persist to DB ──
        save_scan(result)

        # ── 5. Save image ──
        img_path = UPLOAD_DIR / f"{scan_id}.jpg"
        img_path.write_bytes(img_bytes)

        return jsonify(result), 200

    except ValueError as ve:
        return jsonify({"error": str(ve)}), 422
    except Exception:
        traceback.print_exc()
        return jsonify({"error": "Internal analysis error"}), 500


# ── /results/<scan_id> ────────────────────────────────────
@app.route("/results/<scan_id>", methods=["GET"])
def results(scan_id):
    row = get_scan(scan_id)
    if not row:
        return jsonify({"error": "Scan not found"}), 404
    return jsonify(row), 200


# ── /sendtoesp32 ──────────────────────────────────────────
@app.route("/sendtoesp32", methods=["POST"])
def sendtoesp32():
    payload = request.get_json(silent=True) or {}

    esp_data = {
        "face_shape":  payload.get("face_shape",  ""),
        "eye_shape":   payload.get("eye_shape",   ""),
        "frame_size":  payload.get("frame_size",  ""),
        "frame_style": payload.get("frame_style", ""),
        "pd":          payload.get("pd",           0),
    }

    scan_id = payload.get("scan_id", "unknown")
    target_ip = payload.get("esp32_ip", ESP32_IP)
    target_port = payload.get("esp32_port", ESP32_PORT)

    try:
        url  = f"http://{target_ip}:{target_port}/data"
        resp = requests.post(
            url,
            json=esp_data,
            timeout=4,
            headers={"Content-Type": "application/json"}
        )
        log_esp32(scan_id, "success", resp.text[:200])
        return jsonify({"success": True, "esp32_response": resp.text}), 200

    except requests.exceptions.ConnectionError:
        log_esp32(scan_id, "connection_error")
        return jsonify({"success": False, "message": "ESP32 not reachable at " + ESP32_IP}), 503
    except requests.exceptions.Timeout:
        log_esp32(scan_id, "timeout")
        return jsonify({"success": False, "message": "ESP32 connection timed out"}), 504
    except Exception as e:
        log_esp32(scan_id, "error", str(e))
        return jsonify({"success": False, "message": str(e)}), 500


# ── /history ──────────────────────────────────────────────
@app.route("/history", methods=["GET"])
def history():
    limit = min(int(request.args.get("limit", 50)), 200)
    rows  = get_all_scans(limit)
    return jsonify({"count": len(rows), "scans": rows}), 200


# ── /stats (admin dashboard) ──────────────────────────────
@app.route("/stats", methods=["GET"])
def stats():
    return jsonify(get_stats()), 200


# ── Run ───────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 56)
    print("  SpectAI Flask Backend  –  http://127.0.0.1:5000")
    print("  ESP32 target           –  " + ESP32_IP)
    print("=" * 56)
    app.run(host="0.0.0.0", port=5000, debug=True)
