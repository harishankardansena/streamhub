const socket = io();

// Check for Secure Context
if (!window.isSecureContext) {
    alert("Warning: Insecure connection (HTTP) detected.\nStreaming might fail on mobile devices. Please use HTTPS or localhost.");
}

const peerConnectConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
    ]
};

let peerConnections = {};
const audioElement = document.getElementById('audio-element');
const playlistEl = document.getElementById('playlist');
const currentTrackTitleEl = document.getElementById('current-track-title');
const playPauseBtn = document.getElementById('play-pause-btn');
const seekBar = document.getElementById('seek-bar');
const currentTimeEl = document.getElementById('current-time');
const durationEl = document.getElementById('duration');

let playlist = [];
let currentTrackIndex = 0;
let currentStream = null;

// Get Room ID from URL
const urlParams = new URLSearchParams(window.location.search);
const room = urlParams.get('room') || 'music-room';
document.getElementById('room-id').textContent = room;

// Viewer Tracking
let viewerCount = 0;
const headerEl = document.querySelector('.header');
const viewerCountEl = document.createElement('span');
viewerCountEl.style.fontSize = '0.9rem';
viewerCountEl.style.marginLeft = '10px';
viewerCountEl.innerText = '👁️ 0 Viewers';
headerEl.querySelector('div:last-child').appendChild(viewerCountEl);

function updateViewerCount(diff) {
    viewerCount += diff;
    if (viewerCount < 0) viewerCount = 0;
    viewerCountEl.innerText = `👁️ ${viewerCount} Viewers`;
}

// ==========================================
// PLAYLIST LOGIC
// ==========================================
function handleFolderSelect(input) {
    const files = Array.from(input.files);

    // Filter audio files
    const audioFiles = files.filter(file => file.type.startsWith('audio/'));

    if (audioFiles.length === 0) {
        alert("No audio files found in this folder.");
        return;
    }

    // Sort alphabetically
    audioFiles.sort((a, b) => a.name.localeCompare(b.name));

    playlist = audioFiles;
    renderPlaylist();

    // Switch View
    document.getElementById('folder-selection').style.display = 'none';
    document.getElementById('playlist-view').style.display = 'block';
    document.querySelector('.main-content').style.overflowY = 'auto'; // Enable scroll for playlist

    // Auto-play first track
    playTrack(0);
}

function renderPlaylist() {
    playlistEl.innerHTML = '';
    playlist.forEach((file, index) => {
        const li = document.createElement('li');
        li.className = 'track-item';
        li.textContent = file.name;
        li.onclick = () => playTrack(index);

        if (index === currentTrackIndex) {
            li.classList.add('active');
        }

        playlistEl.appendChild(li);
    });
}

function playTrack(index) {
    if (index < 0 || index >= playlist.length) return;

    currentTrackIndex = index;
    const file = playlist[index];

    // Create object URL
    const fileUrl = URL.createObjectURL(file);
    audioElement.src = fileUrl;
    audioElement.play();

    // Update UI
    currentTrackTitleEl.textContent = file.name;
    playPauseBtn.textContent = '⏸';
    renderPlaylist(); // Update active class

    // Start Broadcast Capability if not already started
    if (!currentStream) {
        initStream();
    }
}

function togglePlay() {
    if (audioElement.paused) {
        audioElement.play();
        playPauseBtn.textContent = '⏸';
    } else {
        audioElement.pause();
        playPauseBtn.textContent = '▶';
    }
}

function playNext() {
    let nextIndex = currentTrackIndex + 1;
    if (nextIndex >= playlist.length) nextIndex = 0; // Loop
    playTrack(nextIndex);
}

function playPrev() {
    let prevIndex = currentTrackIndex - 1;
    if (prevIndex < 0) prevIndex = playlist.length - 1; // Loop
    playTrack(prevIndex);
}

// Seek Bar Logic
audioElement.addEventListener('timeupdate', () => {
    const current = audioElement.currentTime;
    const duration = audioElement.duration;

    if (!isNaN(duration)) {
        seekBar.value = (current / duration) * 100;
        currentTimeEl.textContent = formatTime(current);
        durationEl.textContent = formatTime(duration);
    }
});

seekBar.addEventListener('input', () => {
    const duration = audioElement.duration;
    if (!isNaN(duration)) {
        audioElement.currentTime = (seekBar.value / 100) * duration;
    }
});

audioElement.addEventListener('ended', playNext);

function formatTime(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

// ==========================================
// BROADCAST LOGIC (WebRTC)
// ==========================================
function initStream() {
    // Capture stream from audio element
    let stream;
    if (audioElement.captureStream) {
        stream = audioElement.captureStream();
    } else if (audioElement.mozCaptureStream) {
        stream = audioElement.mozCaptureStream();
    } else {
        alert("Your browser does not support audio capture.");
        return;
    }

    currentStream = stream;
    console.log("Music Stream Started");

    // Notify Server
    socket.emit("broadcaster", room);
}

// Watcher joins -> Create PeerConnection
socket.on("watcher", (id) => {
    if (!currentStream) return;

    const peerConnection = new RTCPeerConnection(peerConnectConfig);
    peerConnections[id] = peerConnection;

    // Update Viewer Count
    updateViewerCount(1);

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
        updateViewerCount(-1);
    }
});
