const express = require('express');
const app = express();
const mongoose = require('mongoose');
const http = require('http').createServer(app);
const Room = require('./models/room');
const Counter = require('./models/counter');

const dbKey = require('./config/keys').mongoURI;
const PORT = 3000;
const io = require('socket.io')(http, {
  cors: {
    origin: '*',
  },
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

mongoose.set('useFindAndModify', false);
mongoose
  .connect(dbKey, { useUnifiedTopology: true, useNewUrlParser: true })
  .then(() => console.log('Connected to DB'))
  .catch((err) => console.log(err));

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
  players = {};

io.on('connection', function (socket) {
  playerCount++;
  players[socket.id] = {
    uuid: socket.handshake.query.uuid,
    name: socket.handshake.query.name,
  };
  console.log(
    'A user connected:',
    socket.id,
    socket.handshake.query.uuid,
    socket.handshake.query.name
  );
  socket.on('findRoom', (player) => {
    console.log;
    let data = player;
    delete data.count;
    Room.findOneAndUpdate(
      { room_playerLength: { $lt: player.count }, room_isPlaying: false },
      { $push: { room_players: data }, $inc: { room_playerLength: 1 } },
      async (err, room) => {
        if (err) {
          console.log(err);
          return;
        }
        if (room) {
          socket.join(room._id);
          socket.emit('roomId', room);
        } else {
          Counter.findOneAndUpdate(
            { _id: 'roomid' },
            { $inc: { sequence_value: 1 } },
            (err, count) => {
              const newRoom = new Room({
                _id: count.sequence_value,
                room_playerLength: 1,
                room_players: [data],
              });
              newRoom.save().then((success) => {
                socket.join(success._id);
                console.log('Room created!', success._id);
                socket.emit('roomId', success);
              });
            }
          );
        }
      }
    );
  });
  socket.on('shuffleCards', (roomId) => {
    io.to(roomId).emit('deck', shuffleCards());
  });

  Room.watch().on('change', (room) => {
    io.to(room.fullDocument._id).emit('');
  });
  socket.on('disconnecting', function () {
    playerCount--;
    let roomId = [...socket.rooms][1];
    console.log(`${socket.id} left room ${roomId} disconnected`);
    socket.leave(roomId);
    Room.findById({ roomId }, (err, room) => {});
    delete players[socket.id];
  });
});

http.listen(PORT, function () {
  console.log(`Server started! http://localhost:${PORT}/`);
});
