const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const io = require("socket.io")(server);

// Serve static files from 'public' directory
app.use(express.static(__dirname + "/public"));

// ICE Configuration Endpoint
app.get("/api/ice-config", (req, res) => {
    // Default STUN servers (Free & Public) - Extensive List for better Global Reach from server
    let iceServers = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        { urls: "stun:global.stun.twilio.com:3478" },
        { urls: "stun:stun.stunprotocol.org:3478" },
        { urls: "stun:stun.framasoft.org:3478" },
        { urls: "stun:stun.voip.blackberry.com:3478" }
    ];

    // Add TURN server if configured in Environment Variables
    if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
        iceServers.push({
            urls: process.env.TURN_URL,
            username: process.env.TURN_USERNAME,
            credential: process.env.TURN_CREDENTIAL
        });
        console.log("TURN Server configured and sent to client.");
    }

    res.json({ iceServers });
});

io.sockets.on("error", (e) => console.log(e));

io.sockets.on("connection", (socket) => {
    // Event: Broadcaster joins a room
    socket.on("broadcaster", (room) => {
        socket.join(room);
        socket.broadcasterRoom = room; // Tag socket with room
        socket.to(room).emit("broadcaster");
        console.log(`Broadcaster joined room: ${room}`);
    });

    // Event: Watcher joins a room
    socket.on("watcher", (room) => {
        socket.join(room);
        socket.to(room).emit("watcher", socket.id);
        console.log(`Watcher ${socket.id} joined room: ${room}`);
    });

    // Event: Offer (Broadcaster -> Watcher)
    socket.on("offer", (id, message) => {
        socket.to(id).emit("offer", socket.id, message);
    });

    // Event: Answer (Watcher -> Broadcaster)
    socket.on("answer", (id, message) => {
        socket.to(id).emit("answer", socket.id, message);
    });

    // Event: ICE Candidate (P2P Connectivity)
    socket.on("candidate", (id, message) => {
        socket.to(id).emit("candidate", socket.id, message);
    });

    // Event: Disconnect
    socket.on("disconnect", () => {
        if (socket.broadcasterRoom) {
            socket.to(socket.broadcasterRoom).emit("broadcaster_left");
        } else {
            socket.to(socket.broadcasterRoom).emit("disconnectPeer", socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
