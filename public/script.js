const socket = io();

// Check for Secure Context (HTTPS or localhost)
if (!window.isSecureContext) {
    alert("Warning: You are accessing this site via an insecure connection (HTTP). \n\n" +
        "Broadcasting (Microphone/Camera/Screen Share) will NOT work on mobile devices or other computers on the network.\n\n" +
        "To fix this:\n" +
        "1. Use 'localhost' if testing on this PC.\n" +
        "2. Setup HTTPS if deploying.\n" +
        "3. For local mobile testing, you might need to enable 'Insecure origins treated as secure' in chrome://flags.");
}

// Config for STUN servers (Google's public STUN)
const peerConnectConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
    ]
};

let peerConnections = {}; // Store connections for broadcaster (socketId -> RTCPeerConnection)
let peerConnection; // Single connection for viewer

// ==========================================
// BROADCASTER LOGIC
// ==========================================
const videoElement = document.getElementById("video");
const audioInput = document.getElementById("audio-file");
const localAudioPlayer = document.getElementById("local-audio-player");
const modal = document.getElementById("mode-modal");
let currentStream = null;

// UI Functions
function showModeSelection() {
    modal.style.display = "block";
}

function closeModal() {
    modal.style.display = "none";
}

function selectMode(mode) {
    closeModal();
    if (mode === 'screen') {
        startScreenShare();
    } else if (mode === 'system-audio') {
        startSystemAudio();
    } else if (mode === 'audio') {
        // Trigger file picker
        audioInput.click();
    }
}

function handleFileSelection(input) {
    const file = input.files[0];
    if (file) {
        startAudioStream(file);
    }
}

// Logic Functions
async function startSystemAudio() {
    videoElement.style.display = 'none'; // Audio only
    localAudioPlayer.style.display = 'none';

    try {
        const constraints = {
            video: true, // Required to get system audio prompt
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                sampleRate: 44100
            }
        };
        // This will prompt for screen share, user MUST select "Share system audio"
        const stream = await navigator.mediaDevices.getDisplayMedia(constraints);

        // Validation: Check for audio track
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
            alert("Error: No system audio detected. Please ensure you checked 'Share system audio'.");
            stream.getTracks().forEach(t => t.stop());
            return;
        }

        // We only want the audio track for streaming to save bandwidth
        // But we need to keep the video track alive locally or the browser stops the stream
        // So we just don't add it to the peer connection later (handled in logic or we modify stream here)

        // Actually, let's create a new stream with just the audio track for currentStream
        // But we need the original stream to listen for 'ended' event on video track (when user stops sharing)
        const audioStream = new MediaStream(audioTracks);

        // Store original stream reference to stop it properly
        stream.getVideoTracks()[0].onended = () => {
            alert("System audio capture stopped.");
            stopBroadcast();
        };

        // For local preview, we don't need to hear ourselves (feedback loop)
        // But visual feedback would be nice. For now, just set currentStream.
        currentStream = audioStream;

        console.log("System audio stream started");
        notifyServerAndLockUI();

    } catch (error) {
        console.error("Error accessing system audio.", error);

        let errorMsg = `Error: ${error.message}`;

        if (error.name === 'NotAllowedError') {
            errorMsg = "Permission denied. You must select a window/screen and check 'Share system audio'.";
        } else if (error.name === 'NotFoundError' || error.message.includes('getDisplayMedia')) {
            errorMsg = "System Audio Capture failed. Your device or browser might not support sharing system audio directly.\n\nTry 'Audio File' mode or check if your browser supports 'Screen Cast' with audio.";
        }

        alert(errorMsg);
    }
}

// Logic Functions
async function startScreenShare() {
    videoElement.style.display = 'block';
    localAudioPlayer.style.display = 'none';

    try {
        const constraints = {
            video: { cursor: "always" },
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        };
        currentStream = await navigator.mediaDevices.getDisplayMedia(constraints);

        // Check for audio
        if (currentStream.getAudioTracks().length === 0) {
            alert("Warning: No system audio shared. Viewers might not hear anything.");
        }

        videoElement.srcObject = currentStream;
        videoElement.muted = true; // Mute local video preview

        // Handle stop
        currentStream.getVideoTracks()[0].onended = () => {
            alert("Screen sharing stopped.");
            stopBroadcast();
        };

        notifyServerAndLockUI();

    } catch (error) {
        console.error("Error accessing display media.", error);
        if (error.name === 'NotAllowedError') {
            // User cancelled
        } else {
            alert(`Error: ${error.message}`);
        }
    }
}

async function startAudioStream(file) {
    videoElement.style.display = 'none';
    localAudioPlayer.style.display = 'block';

    try {
        // Play local file
        localAudioPlayer.src = URL.createObjectURL(file);
        localAudioPlayer.play();

        // Capture stream from audio element
        if (localAudioPlayer.captureStream) {
            currentStream = localAudioPlayer.captureStream();
        } else if (localAudioPlayer.mozCaptureStream) {
            currentStream = localAudioPlayer.mozCaptureStream();
        } else {
            alert("Your browser does not support capturing audio from files. Please use Chrome or Firefox.");
            return;
        }

        console.log("Audio file stream started");
        notifyServerAndLockUI();

    } catch (error) {
        console.error("Error starting audio stream:", error);
        alert(`Error: ${error.message}`);
    }
}

function notifyServerAndLockUI() {
    socket.emit("broadcaster", room);
    const startBtn = document.getElementById("start-btn");
    startBtn.disabled = false;
    startBtn.innerText = "Stop Broadcast";
    startBtn.style.backgroundColor = "#dc3545"; // Red color
    startBtn.onclick = stopBroadcast;
}

function stopBroadcast() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }
    window.location.reload();
}

// Initial Broadcaster setup (waiting for watchers)
// This part listens for 'watcher' events effectively "always" but we only react if we have a stream.
socket.on("watcher", (id) => {
    if (!currentStream) return; // Don't connect if not broadcasting

    const peerConnection = new RTCPeerConnection(peerConnectConfig);
    peerConnections[id] = peerConnection;

    // Add tracks to peer connection
    currentStream.getTracks().forEach(track => peerConnection.addTrack(track, currentStream));

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            socket.emit("candidate", id, event.candidate);
        }
    };

    peerConnection
        .createOffer()
        .then(sdp => peerConnection.setLocalDescription(sdp))
        .then(() => {
            socket.emit("offer", id, peerConnection.localDescription);
        })
        .catch(e => console.error(e));
});

socket.on("answer", (id, description) => {
    if (peerConnections[id]) {
        peerConnections[id].setRemoteDescription(description);
    }
});

socket.on("candidate", (id, candidate) => {
    if (peerConnections[id]) {
        peerConnections[id].addIceCandidate(new RTCIceCandidate(candidate));
    }
});

socket.on("disconnectPeer", (id) => {
    if (peerConnections[id]) {
        peerConnections[id].close();
        delete peerConnections[id];
    }
});

// Remove old initBroadcaster call from initialization logic in HTML since we now have manual start
// We will simply make 'initBroadcaster' available globally if needed, or just rely on the script execution.
// Actually, let's keep the socket listeners active.


// ==========================================
// VIEWER LOGIC
// ==========================================
function log(msg) {
    const logEl = document.getElementById('debug-log');
    if (logEl) {
        logEl.innerText += `\n${msg}`;
        console.log(msg);
    }
}

function startViewer() {
    document.getElementById('connect-overlay').style.display = 'none';
    const room = new URLSearchParams(window.location.search).get('room');
    if (room) {
        initViewer(room);
    } else {
        alert("No room ID found!");
    }
}

function initViewer(room) {
    log(`Initializing viewer for room: ${room}`);
    socket.emit("watcher", room);
    const videoElement = document.getElementById("video");
    const statusText = document.getElementById("status");

    socket.on("offer", (id, description) => {
        statusText.innerText = "Status: Connecting...";
        log("Received offer from broadcaster");

        peerConnection = new RTCPeerConnection(peerConnectConfig);

        peerConnection
            .setRemoteDescription(description)
            .then(() => peerConnection.createAnswer())
            .then(sdp => peerConnection.setLocalDescription(sdp))
            .then(() => {
                socket.emit("answer", id, peerConnection.localDescription);
                log("Sent answer to broadcaster");
            })
            .catch(e => log(`Error handling offer: ${e}`));

        peerConnection.ontrack = event => {
            log("Track received!");
            videoElement.srcObject = event.streams[0];
            statusText.innerText = "Status: Live";

            // Try explicit play for mobile
            videoElement.play().catch(e => log(`Autoplay failed: ${e}`));
        };

        peerConnection.onicecandidate = event => {
            if (event.candidate) {
                socket.emit("candidate", id, event.candidate);
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            log(`ICE State: ${peerConnection.iceConnectionState}`);
            if (peerConnection.iceConnectionState === 'disconnected') {
                statusText.innerText = "Status: Disconnected";
            }
        };
    });

    socket.on("candidate", (id, candidate) => {
        if (peerConnection) {
            peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
                .catch(e => log(`Error adding candidate: ${e}`));
        }
    });

    socket.on("broadcaster", () => {
        log("Broadcaster available. Sending watcher request...");
        socket.emit("watcher", room);
    });

    socket.on("broadcaster_left", () => {
        statusText.innerText = "Status: Broadcaster ended the stream.";
        log("Broadcaster left");
        videoElement.srcObject = null;
        if (peerConnection) peerConnection.close();
    });
}
