const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const io = require("socket.io")(server);

// Serve static files from 'public' directory
app.use(express.static(__dirname + "/public"));

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
