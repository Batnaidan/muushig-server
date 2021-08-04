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

let timeOut, deck;

io.on('connection', function (socket) {
  socket.data.uuid = socket.handshake.query.uuid;
  socket.data.name = socket.handshake.query.name;
  console.log(
    socket.handshake.query.name,
    'connected',
    socket.id,
    socket.handshake.query.uuid
  );

  socket.on('findRoom', (player) => {
    let data = JSON.parse(JSON.stringify(player));
    delete data.count;
    delete data.roomId;
    if (player.roomId) {
      Room.findOneAndUpdate(
        {
          _id: player.roomId,
          room_playerLength: { $lt: 5 },
          room_isPlaying: false,
        },
        { $push: { room_players: data }, $inc: { room_playerLength: 1 } },
        {
          new: true,
        },
        (err, room) => {
          socket.join(room._id);
          console.log('Room joined!', room._id);
          socket.emit('roomId', room);
          io.to(room._id).emit('playerChange', room);
          socket.data.roomId = [...socket.rooms][1];
          if (room.room_playerLength >= 2) restartCountDown();
        }
      );
    } else {
      Room.findOneAndUpdate(
        { room_isPlaying: false, room_playerLength: { $lt: player.count } },
        { $push: { room_players: data }, $inc: { room_playerLength: 1 } },
        { new: true },
        (err, room) => {
          if (err) {
            console.log(err);
            return;
          }
          if (room) {
            socket.join(room._id);
            socket.emit('roomId', room);
            io.to(room._id).emit('playerChange', room);
            socket.data.roomId = [...socket.rooms][1];
            console.log('Room  joined!', socket.data.roomId);
            if (room.room_playerLength >= 2) restartCountDown();
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
                  socket.emit('roomId', success);
                  io.to(success._id).emit('playerChange', success);
                  socket.data.roomId = [...socket.rooms][1];
                  console.log('Room created and joined!', socket.data.roomId);
                  if (success.room_playerLength >= 2) restartCountDown();
                });
              }
            );
          }
        }
      );
    }
  });
  socket.on('changeReady', (isReady) => {
    Room.findOne(
      {
        _id: socket.data.roomId,
      },
      (err, room) => {
        const isMe = (element) => element.uuid == socket.data.uuid;
        playerIndex = room.room_players.findIndex(isMe);
        console.log(playerIndex);
        if (
          room.room_playerLength > playerIndex + 1 &&
          room.room_stage == 'ready'
        ) {
          room.room_turn = room.room_players[playerIndex + 1].uuid;
        } else if (
          room.room_playerLength == playerIndex + 1 &&
          room.room_stage == 'ready'
        ) {
          room.room_turn = room.room_players[0].uuid;
          room.room_stage = 'change';
        }
        room.room_players[playerIndex].ready = isReady;
        room.markModified('room_players');
        room.save((err, result) => {
          if (!err) io.to(room._id).emit('changeReady', result);
          // } else if(!err && room.room_turn == 'change'){

          // }
        });
      }
    );
  });
  socket.on('changeCards', (droppedCards) => {
    console.log(socket.data.roomId, socket.data.uuid, droppedCards);
    Room.findOne(
      {
        _id: socket.data.roomId,
      },
      (err, room) => {
        const isMe = (element) => element.uuid == socket.data.uuid;
        playerIndex = room.room_players.findIndex(isMe);
        console.log(playerIndex);
        if (
          room.room_playerLength > playerIndex + 1 &&
          room.room_stage == 'change'
        ) {
          room.room_turn = room.room_players[playerIndex + 1].uuid;
        } else if (room.room_deck.length == 0 && room.room_stage == 'change') {
          room.room_stage = 'put';
          room.room_turn = room.room_players[0].uuid;
        }
        droppedCards.forEach((card) => {
          let i = room.room_players[playerIndex].cards.indexOf(card);
          room.room_players[playerIndex].cards.splice(i, 1);
        });
        let swapCards = room.room_deck.splice(0, droppedCards.length);
        room.room_players[playerIndex].cards.push(...swapCards);
        room.markModified('room_players');
        room.save((err, result) => {
          if (!err) io.to(room._id).emit('changeCards', result);
          console.log(JSON.stringify(result.room_players));
        });
      }
    );
  });
  socket.on('disconnecting', function () {
    socket.leave(socket.data.roomId);
    let player_uuid = socket.data.uuid;
    let player_name = socket.data.name;
    Room.findOneAndDelete(
      {
        _id: socket.data.roomId,
        'room_players.uuid': player_uuid,
        room_playerLength: 1,
      },
      (err, room) => {
        if (!room) {
          Room.findOneAndUpdate(
            {
              _id: socket.data.roomId,
              room_playerLength: { $gte: 2 },
            },
            {
              $pull: {
                room_players: { uuid: player_uuid },
              },
              $inc: { room_playerLength: -1 },
            },
            (err, success) => {
              if (!err)
                console.log(player_name, 'disconnected', socket.data.roomId);
            }
          );
        }
      }
    );
  });

  function restartCountDown() {
    if (timeOut) clearTimeout(timeOut);

    timeOut = setTimeout(function () {
      deck = shuffleCards();
      let roomRoster = io.sockets.adapter.rooms.get(socket.data.roomId);
      roomRoster = [...roomRoster];
      console.log('Game has started', socket.data.roomId);
      Room.findOne({ _id: socket.data.roomId }, (err, room) => {
        if (!err) {
          room.room_turn = room.room_players[0].uuid;
          for (let i = 0; i < room.room_players.length; i++) {
            room.room_players[i].cards = [
              deck[i * 5],
              deck[i * 5 + 1],
              deck[i * 5 + 2],
              deck[i * 5 + 3],
              deck[i * 5 + 4],
            ];
          }
          room.markModified('room_players');
          room.room_specialCard = deck[25];
          room.room_deck = deck.slice(26);
          room.room_dealer = io.sockets.sockets.get(roomRoster[0]).data.uuid;
          room.room_isPlaying = true;
          room.save((err, result) => {
            console.log(JSON.stringify(result.room_players));
            if (!err) {
              io.to(room._id).emit('startGame', result);
            }
          });
        }
      });
    }, 1000);
  }
});

http.listen(PORT, function () {
  console.log(`Server started! http://localhost:${PORT}/`);
});
