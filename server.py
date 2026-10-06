#!/home/matt/night_cam/bin/python3
import os
import re
import time
import threading
from flask import Flask, jsonify, render_template, request
from flask_cors import CORS
import gpiod
from gpiod.line import Direction, Value, Bias

# --- Configuration ---
GPIO_PIN = 18
CHIP_PATH = "/dev/gpiochip0"
HOLD_TIME_SEC = 30     # Seconds to keep IR LEDs on after sound stops
FIFO_PATH = "/tmp/audio_levels"
LED_SAFETY_TIMEOUT_SEC = 3600  # Seconds after which to auto-turn off manual IR override

app = Flask(__name__)
CORS(app)

# Configure GPIO 18 via gpiod v2
gpio_request = gpiod.request_lines(
    CHIP_PATH,
    consumer="IR_Light",
    config={
        GPIO_PIN: gpiod.LineSettings(
            direction=Direction.OUTPUT,
            output_value=Value.INACTIVE,
            bias=Bias.PULL_DOWN
        )
    }
)

# Shared state across threads
last_sound_time = 0
ir_active = False
lock = threading.Lock()
triggered = False
manual_control = False
last_manual_control_time = 0
current_rms_db = -100.0  # Stores live decibel level
threshold_db = -35.0   # Trigger threshold in dB


def set_ir(state: bool):
    global ir_active
    with lock:
        val = Value.ACTIVE if state else Value.INACTIVE
        gpio_request.set_value(GPIO_PIN, val)
        ir_active = state
        print(f"[GPIO] IR LED set to {'ON' if state else 'OFF'}")

def _light_off():
    set_ir(False)

def _light_on():
    set_ir(True)

def trigger(trigger_time=None):
    global triggered, last_sound_time
    last_sound_time = trigger_time or time.time()
    triggered = True


def led_control_thread():
    """Background thread that reads decibel levels from FIFO and manages IR state."""
    global last_sound_time
    global current_rms_db
    global triggered
    global manual_control
    global last_manual_control_time

    # Ensure FIFO exists
    if not os.path.exists(FIFO_PATH):
        try:
            os.mkfifo(FIFO_PATH)
            print(f"[AUDIO] Created FIFO pipe at {FIFO_PATH}")
        except OSError as e:
            print(f"[AUDIO] Failed to create FIFO: {e}")

    print(f"[AUDIO] Listening on {FIFO_PATH}... (Threshold: {threshold_db} dB)")
    regex_pattern = re.compile(r'rms=\(GValueArray\)<\s*(-?\d+(?:\.\d+)?)')

    while True:
        try:
            with open(FIFO_PATH, "r") as fifo:
                print("[AUDIO] Connected to FIFO stream.")
                for line in fifo:
                    match = regex_pattern.search(line)
                    if match:
                        now = time.time()  # Updated per-sample
                        rms_db = float(match.group(1))
                        current_rms_db = rms_db

                        # 1. Sound Triggering
                        if rms_db > threshold_db:
                            trigger(now)

                        # 2. Trigger State Processing
                        if triggered:
                            if not ir_active:
                                print(f"*** SOUND DETECTED ({rms_db:.1f} dB) -> IR ON ***")
                                _light_on()
                            elif now - last_sound_time > HOLD_TIME_SEC:
                                print(f"*** SILENCE HOLD TIMEOUT -> IR AUTO OFF ***")
                                triggered = False
                                if not manual_control and ir_active:
                                    _light_off()

                        # 3. Manual Override Safety Timeout Check
                        if manual_control and (now - last_manual_control_time > LED_SAFETY_TIMEOUT_SEC):
                            print(f"*** MANUAL SAFETY TIMEOUT REACHED -> IR OFF ***")
                            manual_control = False
                            _light_off()

        except Exception as e:
            print(f"[AUDIO] Pipe reading error: {e}, retrying in 2s...")
            time.sleep(2)


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/light/on', methods=['GET', 'POST'])
def light_on():
    global manual_control, last_manual_control_time
    last_manual_control_time = time.time()
    manual_control = True
    _light_on()
    return jsonify({"status": "success", "light": "ON"})

@app.route('/light/off', methods=['GET', 'POST'])
def light_off():
    global manual_control, triggered
    _light_off()
    manual_control = False
    triggered = False  # Clean state reset
    return jsonify({"status": "success", "light": "OFF"})

@app.route('/state', methods=['GET'])
def get_state():
    return jsonify({
        "rms_db": round(current_rms_db, 0),
        "threshold_db": threshold_db,
        "ir_leds": ir_active,
        "triggered": triggered,
        "manual_led_control": manual_control
    })

@app.route('/threshold', methods=['POST'])
def set_threshold():
    global threshold_db
    data = request.get_json()
    if data and 'threshold_db' in data:
        try:
            val = float(data['threshold_db'])
            threshold_db = max(-45.0, min(-20.0, val))
            print(f"[AUDIO] Sensitivity threshold updated to {threshold_db} dB")
            return jsonify({"status": "success", "threshold_db": threshold_db})
        except ValueError:
            pass
    return jsonify({"status": "error", "message": "Invalid threshold value"}), 400

@app.route('/manifest.json')
def serve_manifest():
    return app.send_static_file('manifest.json')


if __name__ == '__main__':
    t = threading.Thread(target=led_control_thread, daemon=True)
    t.start()

    app.run(host='0.0.0.0', port=9000)
