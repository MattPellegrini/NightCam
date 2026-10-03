#!/bin/bash

FIFO_PATH="/tmp/audio_levels"

# 1. Clean up and recreate the RAM FIFO pipe
rm -f "$FIFO_PATH"
mkfifo "$FIFO_PATH"

# 2. Launch Flask LED Server (in virtualenv) in the background
/home/matt/night_cam/bin/python3 -u /home/matt/night_cam/server.py &
FLASK_PID=$!

# Ensure Flask is cleanly killed if MediaMTX exits or service stops
trap "kill $FLASK_PID 2>/dev/null; rm -f $FIFO_PATH" EXIT

# 3. Launch MediaMTX in the foreground (blocks until service stops)
/usr/local/bin/mediamtx /etc/mediamtx.yml
