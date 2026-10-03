document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize native WebRTC stream via WHEP
    startWHEPStream();

    // 2. Poll Decibel Level from Flask
    setInterval(updateAudioMeter, 250);

    // 3. Screen Wake Lock & Interaction listeners
    document.addEventListener('click', initNoSleep);
    document.addEventListener('touchstart', initNoSleep);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            requestWakeLock();
        }
    });

    requestWakeLock();
});

// --- MediaMTX WHEP WebRTC Stream Engine ---
let peerConnection = null;

async function startWHEPStream() {
    const videoEl = document.getElementById('webRTCVideo');
    if (!videoEl) return;

    if (peerConnection) {
        peerConnection.close();
    }

    peerConnection = new RTCPeerConnection();

    // Attach incoming WebRTC media stream to <video> tag
    peerConnection.ontrack = (evt) => {
        if (evt.streams && evt.streams[0]) {
            videoEl.srcObject = evt.streams[0];
        }
    };

    // Request receive-only video stream
    peerConnection.addTransceiver('video', { direction: 'recvonly' });

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
        console.log('Native WHEP WebRTC stream connected.');
    } catch (err) {
        console.warn('WHEP connection failed, retrying in 3 seconds...', err);
        setTimeout(startWHEPStream, 3000);
    }

    // Monitor connection state and auto-reconnect on drops
    peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
            console.warn('WebRTC state changed to:', peerConnection.connectionState, '- Reconnecting...');
            setTimeout(startWHEPStream, 2000);
        }
    };
}

// --- Settings Menu Popup ---
function toggleSettingsMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('settingsMenu');
    menu.classList.toggle('active');
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('settingsMenu');
    const btnContainer = document.querySelector('.settings-btn-container');
    if (menu && menu.classList.contains('active') && !btnContainer.contains(e.target)) {
        menu.classList.remove('active');
    }
});

// --- Image Filters (Applied directly to native <video>) ---
function updateImageFilter() {
    const isGrayscale = document.getElementById('grayscaleToggle').checked;
    const brightness = document.getElementById('brightnessRange').value;
    const contrast = document.getElementById('contrastRange').value;

    document.getElementById('brightnessVal').innerText = `${brightness}%`;
    document.getElementById('contrastVal').innerText = `${contrast}%`;

    let filterString = `brightness(${brightness}%) contrast(${contrast}%)`;
    if (isGrayscale) {
        filterString += ` grayscale(100%)`;
    }

    const videoEl = document.getElementById('webRTCVideo');
    if (videoEl) {
        videoEl.style.filter = filterString;
    }
}

// --- IR Light State Controls ---
let currentIrState = false;

function toggleLight() {
    const nextAction = currentIrState ? 'off' : 'on';
    fetch(`/light/${nextAction}`, { method: 'POST' })
        .then(response => response.json())
        .then(data => {
            currentIrState = (data.light === 'ON');
            updateIrButtonUI(currentIrState);
        })
        .catch(err => console.error('Error toggling light:', err));
}

function updateIrButtonUI(isOn) {
    const btn = document.getElementById('irToggleBtn');
    if (isOn) {
        btn.classList.remove('icon-off');
        btn.classList.add('icon-on-yellow');
    } else {
        btn.classList.remove('icon-on-yellow');
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

// --- Decibel Audio Level Polling ---
function updateAudioMeter() {
    fetch('/state')
        .then(res => res.json())
        .then(data => {
            const dbText = document.getElementById('dbText');
            const dbBar = document.getElementById('dbBar');

            dbText.innerText = `${data.rms_db} dB`;

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
