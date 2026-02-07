const socket = io();

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
async function initBroadcaster(room) {
    const videoElement = document.getElementById("video");

    // Get Screen & System Audio
    const constraints = {
        video: {
            cursor: "always"
        },
        audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
        }
    };

    try {
        // requesting display media (screen share)
        const stream = await navigator.mediaDevices.getDisplayMedia(constraints);

        // Check if user shared audio
        if (stream.getAudioTracks().length === 0) {
            alert("Warning: No system audio shared. Please check 'Share system audio' in the popup.");
        }

        videoElement.srcObject = stream;
        videoElement.muted = true; // Local preview should be muted to prevent feedback loop
        socket.emit("broadcaster", room);

        // Handle user stopping screen share via browser UI
        stream.getVideoTracks()[0].onended = () => {
            alert("Screen sharing stopped.");
            window.location.href = '/';
        };

    } catch (error) {
        console.error("Error accessing display media.", error);
        if (error.name === 'NotAllowedError') {
            alert("Permission denied. You must allow screen sharing to broadcast.");
            window.location.href = '/';
        }
    }

    // Watcher joins -> Create PeerConnection
    socket.on("watcher", (id) => {
        const peerConnection = new RTCPeerConnection(peerConnectConfig);
        peerConnections[id] = peerConnection;

        const stream = videoElement.srcObject;
        // Add all tracks (video + system audio) to peer connection
        stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));

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
        peerConnections[id].setRemoteDescription(description);
    });

    socket.on("candidate", (id, candidate) => {
        peerConnections[id].addIceCandidate(new RTCIceCandidate(candidate));
    });

    // Cleanup when viewer disconnects
    socket.on("disconnectPeer", (id) => {
        if (peerConnections[id]) {
            peerConnections[id].close();
            delete peerConnections[id];
        }
    });
}

// ==========================================
// VIEWER LOGIC
// ==========================================
function initViewer(room) {
    socket.emit("watcher", room);
    const videoElement = document.getElementById("video");
    const statusText = document.getElementById("status");

    socket.on("offer", (id, description) => {
        statusText.innerText = "Connecting to stream...";
        peerConnection = new RTCPeerConnection(peerConnectConfig);

        peerConnection
            .setRemoteDescription(description)
            .then(() => peerConnection.createAnswer())
            .then(sdp => peerConnection.setLocalDescription(sdp))
            .then(() => {
                socket.emit("answer", id, peerConnection.localDescription);
            });

        peerConnection.ontrack = event => {
            videoElement.srcObject = event.streams[0];
            statusText.innerText = "Live";
        };

        peerConnection.onicecandidate = event => {
            if (event.candidate) {
                socket.emit("candidate", id, event.candidate);
            }
        };
    });

    socket.on("candidate", (id, candidate) => {
        peerConnection
            .addIceCandidate(new RTCIceCandidate(candidate))
            .catch(e => console.error(e));
    });

    socket.on("broadcaster", () => {
        socket.emit("watcher", room); // Retry connection if broadcaster reconnects
    });

    socket.on("broadcaster_left", () => {
        statusText.innerText = "Broadcaster ended the stream.";
        videoElement.srcObject = null;
        if (peerConnection) peerConnection.close();
    });
}
