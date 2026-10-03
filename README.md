# NightCam 🌙👶

A lightweight, low-latency night-vision baby monitor built on a Raspberry Pi. It streams smooth, low-delay WebRTC video and audio using MediaMTX and GStreamer, features automated IR LED illuminator activation triggered by room audio levels, and provides a mobile-friendly dashboard with screen keep-alive capabilities.

Created by **Matt Pellegrini**.

---

## Key Features

- **Low-Latency WebRTC Streaming:** Native browser video and audio decoding via MediaMTX and WHEP protocol (sub-half-second latency).
- **Sound-Activated Night Vision:** Reads raw audio RMS levels from a USB microphone using a GStreamer `audiolevel` pipeline and automatically triggers IR LEDs via GPIO when noise exceeds a customizable threshold.
- **Three-State IR Light Control:** Seamlessly switch between OFF, AUTO (audio-triggered with auto-off timer), and MANUAL (user overlay override).
- **Mobile Keep-Alive:** Uses native HTML5 video decoding and the Screen Wake Lock API to prevent mobile browsers from timing out or putting the screen to sleep.
- **Client-Side Image Filters:** On-the-fly JavaScript controls for brightness and contrast adjustment directly in the web UI.
- **Auto-Starting Systemd Service:** Single service deployment that automatically manages the RAM FIFO pipe, Flask server, and MediaMTX background daemon.

---

## Hardware Requirements

- **Raspberry Pi** (3B+, 4, 5, or Zero 2 W recommended)
- **Raspberry Pi NoIR Camera** (e.g., NoIR Camera Module V2)
- **USB Microphone** or USB Sound Card / USB Audio Device (e.g., `hw:UACDemoV10,0`)
- **IR LED Illuminator Array** connected via an NPN transistor or relay circuit to GPIO 18
- **5V Power Supply** with sufficient amperage for the Pi and IR LEDs

---

## Architecture Overview

1. Video & Audio Stream: NoIR Cam + USB Mic -> GStreamer Pipeline -> MediaMTX (WHEP :8889) -> Web UI Dashboard (:9000)
2. Audio Level Monitoring: GStreamer audiolevel -> /tmp/audio_levels FIFO Pipe -> Flask Backend (server.py) -> GPIO 18 Control (gpiod v2)

---

## Installation & Setup

### 1. System Dependencies

Update your system and install gstreamer, mediamtx, and gpiod:

sudo apt update
sudo apt install -y python3-pip python3-venv gstreamer1.0-tools \
                    gstreamer1.0-plugins-good gstreamer1.0-plugins-bad \
                    gstreamer1.0-plugins-ugly libgpiod-dev gpiod

Download and install MediaMTX to /usr/local/bin:

wget https://github.com/bluenviron/mediamtx/releases/download/v1.9.0/mediamtx_v1.9.0_linux_arm64v8.tar.gz
tar -xzf mediamtx_v1.9.0_linux_arm64v8.tar.gz
sudo mv mediamtx /usr/local/bin/

---

### 2. Application Setup

Clone this repository and set up the Python virtual environment:

git clone https://github.com/YOUR_USERNAME/night_cam.git /home/matt/night_cam
cd /home/matt/night_cam

python3 -m venv .
source bin/activate
pip install -r requirements.txt

---

### 3. Deploy System Configuration Files

Copy the provided system configuration files into their respective system paths:

# 1. Install MediaMTX configuration
sudo cp system_files/mediamtx.yml /etc/mediamtx.yml

# 2. Install startup script and make it executable
sudo cp system_files/start_camera.sh /usr/local/bin/start_camera.sh
sudo chmod +x /usr/local/bin/start_camera.sh

# 3. Install systemd service
sudo cp system_files/picam.service /etc/systemd/system/picam.service

---

### 4. Enable and Start the Service

Reload systemd, enable the service to start at boot, and run it:

sudo systemctl daemon-reload
sudo systemctl enable picam.service
sudo systemctl start picam.service

Check service status and logs:

sudo systemctl status picam.service
journalctl -u picam.service -f

---

## Configuration & Settings

- **Web Dashboard:** http://<RASPBERRY_PI_IP>:9000
- **WHEP WebRTC Stream Port:** 8889
- **GPIO Pin:** GPIO 18 (managed via gpiod v2)
- **Sound Threshold:** Adjustable in real-time from the UI settings menu (-45 dB to -20 dB) or defaulted in server.py.
- **Hold Time:** 30-second silence timeout before automatic IR LED shutdown.

---

## File Structure

- `server.py` - Flask web server, GPIO controller, and background FIFO listener thread.
- `system_files/mediamtx.yml` - MediaMTX server config defining the rpicam-vid + GStreamer pipeline hook.
- `system_files/start_camera.sh` - Startup script managing the RAM FIFO pipe, Flask server, and MediaMTX process.
- `system_files/picam.service` - Systemd unit file for autostart on boot.
- `static/` & `templates/` - HTML5 frontend UI, CSS styling, and WebRTC JavaScript engine.

---

## Support & Say Thanks

If this project helped you build your own night-vision monitor or saved you time, consider supporting the work or buying me a coffee:

☕ **[Buy Me a Coffee](https://buymeacoffee.com/mattpellegrini)**

Feedback, bug reports, and pull requests are always welcome!

---

## License

This project is licensed under the BSD 2-Clause License - see the LICENSE file for details.
Copyright (c) 2026 Matt Pellegrini.
