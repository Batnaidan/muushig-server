const express = require('express');
const server = express();

const http = require('http').createServer(server);
const db = require('./config/keys').mongoURI;
const io = require('socket.io')(http, {
  cors: {
    origin: '*',
  },
});

function shuffleCards() {
  const suits = ['C', 'D', 'H', 'S'];
  const values = ['7', '8', '9', '10', '11', '12', '13', '14'];
  let deck = [];
  for (let i = 0; i < suits.length; i++) {
    for (let x = 0; x < values.length; x++) {
      deck.push(`${values[x]}${suits[i]}`);
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

let playerCount = 0,
  players = [],
  rooms = [];

io.on('connection', function (socket) {
  playerCount++;
  players.push({
    id: socket.id,
    uuid: socket.handshake.query.uuid,
    name: socket.handshake.query.name,
  });
  console.log(
    'A user connected:',
    socket.id,
    socket.handshake.query.uuid,
    socket.handshake.query.name
  );
  socket.on('findRoom', (contextPlayers) => {
    if (Array.isArray(rooms) && rooms.length) {
      rooms.push({
        isPlaying: false,
        players: [socket.handshake.query],
        deck: null,
      });
    }
    for (let i = 0; i < rooms.length; i++) {
      if (contextPlayers.length + rooms[i].players.length <= 5) {
        socket.join(i);
        socket.emit('roomId', roomId);
        contextPlayers.map((el) => {
          if (el.id !== socket.id) {
            io.to(el.id).emit('roomId', roomId);
          }
        });
      }
      rooms[i].push(socket.handshake.query);
    }
  });
  socket.on('joinRoom', (contextPlayers) => {
    if (Array.isArray(rooms) && rooms.length) {
      rooms.push({
        isPlaying: false,
        players: [socket.handshake.query],
        deck: null,
      });
    } else {
      for (let i = 0; i < rooms.length; i++) {
        if (contextPlayers.length + rooms[i].players.length <= 5) {
          socket.join(i);
          socket.emit('roomId', roomId);
          contextPlayers.map((el) => {
            if (el.id !== socket.id) {
              io.to(el.id).emit('roomId', roomId);
            }
          });
        }
        rooms[i].push(socket.handshake.query);
      }
      let roomId = Math.floor(playerCount / 5);
    }
  });
  socket.on('changePlayerReadyState', (roomId) => {
    io.to(roomId).emit('playerStateChange', playerId); //change Player ready state
  });
  socket.on('shuffleCards', (roomId) => {
    io.to(roomId).emit('deck', shuffleCards());
  });

  socket.on('disconnect', function (roomId) {
    playerCount--;
    for (let i = 0; i < rooms.length; i++) {
      rooms[i].players = rooms[i].players.filter(
        (player) => player.uuid !== socket.handshake.query.uuid
      );
    }
    console.log('A user disconnected:', socket.id);
    players.filter((player) => player.uuid !== socket.handshake.query.uuid);
  });
});

http.listen(3000, function () {
  console.log('Server started!');
});
