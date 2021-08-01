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
  deck;

io.on('connection', function (socket) {
  let roomId;
  playerCount++;
  socket.nickname = socket.handshake.query.uuid.toString();
  console.log(
    'A user connected:',
    socket.id,
    socket.handshake.query.uuid,
    socket.handshake.query.name
  );
  socket.on('findRoom', (player) => {
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
          console.log('Room  joined!', room._id);
          socket.emit('roomId', room);
          io.to(room._id).emit('playerChange', room);
          roomId = [...socket.rooms][1];
          console.log(roomId);
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
                console.log('Room created and joined!', success._id);
                socket.emit('roomId', success);
                roomId = [...socket.rooms][1];
                console.log(roomId);
                io.to(success._id).emit('playerChange', success);
              });
            }
          );
        }
      }
    );
  });
  socket.on('playerStateChange', (isReady) => {
    Room.findOneAndUpdate(
      {
        _id: roomId,
        'room_players.uuid': socket.nickname,
      },
      {
        $set: { 'room_players.$.ready': isReady },
      },
      { new: true },
      (err, room) => {
        if (!err) {
          let playerStateData = {
            id: socket.id,
            uuid: socket.nickname,
            ready: isReady,
          };
          io.to(roomId).emit('playerStateChange', playerStateData);
          let isRoomReady = true;
          room.room_players.forEach((element) => {
            if (element.ready == false) isRoomReady = false;
          });
          if (isRoomReady) {
            deck = shuffleCards();
            Room.findOneAndUpdate(
              {
                _id: roomId,
              },
              {
                room_deck: deck,
              },
              (err, room) => {
                if (!err) {
                  // for (let i = 0; i < 5; i++) {
                  //   playerCards.push({
                  //     skipCount: 0,
                  //     cards: [
                  //       deck.shift(),
                  //       deck.shift(),
                  //       deck.shift(),
                  //       deck.shift(),
                  //       deck.shift(),
                  //     ],
                  //   });
                  // }
                  let roomRoster = io.sockets.adapter.rooms.get(roomId);
                  roomRoster.forEach(function (client) {
                    io.to(roomId).emit('deck', {
                      skipCount: 0,
                      cards: [
                        deck.shift(),
                        deck.shift(),
                        deck.shift(),
                        deck.shift(),
                        deck.shift(),
                      ],
                      //this is the socket of each client in the room.
                      //const clientSocket = io.sockets.sockets.get(clientId);
                    });
                    console.log('Username: ' + client.nickname);
                  });
                }
              }
            );
          }
        }
      }
    );
  });
  // socket.on('');
  socket.on('disconnecting', function () {
    playerCount--;
    console.log(socket.id, 'disconnected', roomId, '');
    socket.leave(roomId);
    Room.findOneAndDelete(
      {
        _id: roomId,
        'room_players.uuid': socket.nickname,
        room_playerLength: 1,
      },
      (err, room) => {
        if (err) {
          Room.findOneAndUpdate(
            {
              _id: roomId,
              'room_players.uuid': socket.nickname,
              room_playerLength: { $gte: 2 },
            },
            {
              $pull: {
                'room_players.uuid': socket.nickname,
              },
              $inc: { room_playerLength: -1 },
            },
            (err, success) => {}
          );
        }
      }
    );
  });
});

http.listen(PORT, function () {
  console.log(`Server started! http://localhost:${PORT}/`);
});
