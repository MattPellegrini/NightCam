document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize native WebRTC stream via WHEP
    startWHEPStream();

    // 2. Poll Decibel Level and IR State from Flask
    setInterval(updateAudioMeter, 250);

    // 3. Screen Wake Lock & Interaction listeners
    document.addEventListener('click', initNoSleep);
    document.addEventListener('touchstart', initNoSleep);

    // 4. Global Auto Unmute on First Touch/Click
    document.addEventListener('click', attemptAutoUnmute, { once: true });
    document.addEventListener('touchstart', attemptAutoUnmute, { once: true });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            requestWakeLock();
        }
    });

    requestWakeLock();
});

// Global state tracking synced with Flask /state
let current_state = {
    ir_leds: false,
    manual_led_control: false,
    triggered: false
};

// --- MediaMTX WHEP WebRTC Stream Engine ---
let peerConnection = null;

async function startWHEPStream() {
    const videoEl = document.getElementById('webRTCVideo');
    if (!videoEl) return;

    if (peerConnection) {
        peerConnection.close();
    }

    peerConnection = new RTCPeerConnection();

    // Attach incoming WebRTC media stream (video + audio) to <video> element
    peerConnection.ontrack = (evt) => {
        if (evt.streams && evt.streams[0]) {
            videoEl.srcObject = evt.streams[0];
        }
    };

    // Request BOTH video AND audio receive tracks from MediaMTX
    peerConnection.addTransceiver('video', { direction: 'recvonly' });
    peerConnection.addTransceiver('audio', { direction: 'recvonly' });

    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Send WHEP SDP Offer to MediaMTX port 8889
        const whepUrl = `http://${window.location.hostname}:8889/cam/whep`;
        const response = await fetch(whepUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/sdp' },
            body: offer.sdp
        });

        if (!response.ok) {
            throw new Error(`WHEP endpoint returned status ${response.status}`);
        }

        const answerSdp = await response.text();
        await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        console.log('Native WHEP WebRTC stream connected (Video + Audio).');
    } catch (err) {
        console.warn('WHEP connection failed, retrying in 3 seconds...', err);
        setTimeout(startWHEPStream, 3000);
    }

    peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
            console.warn('WebRTC state changed to:', peerConnection.connectionState, '- Reconnecting...');
            setTimeout(startWHEPStream, 2000);
        }
    };
}

// --- Audio Mute / Unmute & UI Logic ---
function attemptAutoUnmute() {
    const videoEl = document.getElementById('webRTCVideo');
    if (videoEl && videoEl.muted) {
        videoEl.muted = false;
        videoEl.play().then(() => {
            updateAudioButtonUI(false);
            console.log('Audio successfully unmuted on first user interaction.');
        }).catch(() => {
            // Keep muted alert UI if browser blocks unmuting
            updateAudioButtonUI(true);
        });
    }
}

function updateAudioButtonUI(isMuted) {
    const audioBtn = document.getElementById('audioToggleBtn');
    const mutedIcon = document.getElementById('audioMutedIcon');
    const unmutedIcon = document.getElementById('audioUnmutedIcon');

    if (!audioBtn) return;

    if (isMuted) {
        // Red Alert State with "!" badge
        audioBtn.classList.remove('icon-on-yellow', 'icon-off');
        audioBtn.classList.add('icon-muted-alert');
        if (mutedIcon) mutedIcon.style.display = 'block';
        if (unmutedIcon) unmutedIcon.style.display = 'none';
    } else {
        // Yellow Active State (Matches IR Light ON)
        audioBtn.classList.remove('icon-muted-alert', 'icon-off');
        audioBtn.classList.add('icon-on-yellow');
        if (mutedIcon) mutedIcon.style.display = 'none';
        if (unmutedIcon) unmutedIcon.style.display = 'block';
    }
}

function toggleAudio() {
    const videoEl = document.getElementById('webRTCVideo');
    if (!videoEl) return;

    videoEl.muted = !videoEl.muted;

    if (!videoEl.muted) {
        videoEl.play().catch(err => console.warn('Audio play request failed:', err));
    }

    updateAudioButtonUI(videoEl.muted);
}

// --- Settings Menu Popup ---
function toggleSettingsMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('settingsMenu');
    if (menu) menu.classList.toggle('active');
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('settingsMenu');
    const btnContainer = document.querySelector('.settings-btn-container');
    if (menu && menu.classList.contains('active') && !btnContainer.contains(e.target)) {
        menu.classList.remove('active');
    }
});

// --- Image Filters (Brightness & Contrast) ---
function updateImageFilter() {
    const brightnessRange = document.getElementById('brightnessRange');
    const contrastRange = document.getElementById('contrastRange');

    if (!brightnessRange || !contrastRange) return;

    const brightness = brightnessRange.value;
    const contrast = contrastRange.value;

    document.getElementById('brightnessVal').innerText = `${brightness}%`;
    document.getElementById('contrastVal').innerText = `${contrast}%`;

    const videoEl = document.getElementById('webRTCVideo');
    if (videoEl) {
        videoEl.style.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
    }
}

function resetVideoFilters() {
    const brightnessRange = document.getElementById('brightnessRange');
    const contrastRange = document.getElementById('contrastRange');

    if (brightnessRange) brightnessRange.value = 100;
    if (contrastRange) contrastRange.value = 100;

    updateImageFilter();
}

// Send sound threshold setting to Flask backend
function updateThreshold(val) {
    fetch('/threshold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold_db: parseFloat(val) })
    })
    .catch(err => console.error('Error updating threshold:', err));
}

// --- IR Light State Controls ---
function toggleLight() {
    let endpoint = '/light/off';

    if (!current_state.ir_leds) {
        // Off -> Turn ON (Manual)
        endpoint = '/light/on';
    } else if (current_state.ir_leds && !current_state.manual_led_control) {
        // ON via sound trigger -> Lock ON (Set manual_control = True)
        endpoint = '/light/on';
    } else {
        // ON via manual -> Turn OFF (Set manual_control = False)
        endpoint = '/light/off';
    }

    fetch(endpoint, { method: 'POST' })
        .then(res => res.json())
        .then(() => {
            // Immediately refresh state
            updateAudioMeter();
        })
        .catch(err => console.error('Error toggling light:', err));
}

function updateIrButtonUI(irOn, isManual, isTriggered) {
    const btn = document.getElementById('irToggleBtn');
    if (!btn) return;

    if (irOn) {
        // Light is physically ON -> Yellow icon
        btn.classList.remove('icon-off');
        btn.classList.add('icon-on-yellow');

        // Show "AUTO" badge if triggered by sound (and not locked in manual mode)
        if (!isManual) {
            btn.classList.add('icon-auto');
        } else {
            btn.classList.remove('icon-auto');
        }
    } else {
        // Light is OFF -> Grey icon
        btn.classList.remove('icon-on-yellow', 'icon-auto');
        btn.classList.add('icon-off');
    }
}

// --- Native Fullscreen Trigger ---
function toggleFullScreen() {
    const elem = document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) {
            elem.webkitRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    }
}

// --- State & Audio Polling ---
function updateAudioMeter() {
    fetch('/state')
        .then(res => res.json())
        .then(data => {
            current_state = data;

            // Sync IR LED button state
            updateIrButtonUI(data.ir_leds, data.manual_led_control, data.triggered);

            // Sync threshold slider position from server state if user isn't dragging it
            const thresholdRange = document.getElementById('thresholdRange');
            const thresholdVal = document.getElementById('thresholdVal');
            if (thresholdRange && document.activeElement !== thresholdRange) {
                thresholdRange.value = data.threshold_db;
                if (thresholdVal) thresholdVal.innerText = `${data.threshold_db} dB`;
            }

            const dbText = document.getElementById('dbText');
            const dbBar = document.getElementById('dbBar');

            if (dbText) dbText.innerText = `${data.rms_db} dB`;

            if (dbBar) {
                const minDb = -60;
                const maxDb = 0;
                let percent = ((data.rms_db - minDb) / (maxDb - minDb)) * 100;
                percent = Math.max(0, Math.min(100, percent));

                dbBar.style.width = `${percent}%`;

                if (data.triggered) {
                    dbBar.classList.add('db-triggered');
                } else {
                    dbBar.classList.remove('db-triggered');
                }
            }
        })
        .catch(() => {});
}

// --- Screen Wake Lock Engine ---
let wakeLock = null;

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Screen Wake Lock active');

            wakeLock.addEventListener('release', () => {
                wakeLock = null;
                if (document.visibilityState === 'visible') {
                    setTimeout(requestWakeLock, 1000);
                }
            });
        } catch (err) {
            console.warn('Wake lock error:', err);
            wakeLock = null;
        }
    }
}

function initNoSleep() {
    const videoEl = document.getElementById('webRTCVideo');
    if (videoEl && videoEl.paused) {
        videoEl.play().catch(() => {});
    }

    requestWakeLock();
}
