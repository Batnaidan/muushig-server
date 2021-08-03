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

let timeOut, deck, dealerId;

// Room.findOneAndUpdate(
//   {
//     _id: roomId,
//     'room_players.uuid': socket.data.uuid,
//   },
//   {
//     $set: { 'room_players.$.ready': isReady },
//   },
//   { new: true },
//   (err, room) => {
//     if (!err) {
//       let playerStateData = {
//         id: socket.id,
//         uuid: socket.data.uuid,
//         ready: isReady,
//       };
//       io.to(roomId).emit('playerStateChange', playerStateData);
//       deck = shuffleCards();
//       Room.findOneAndUpdate(
//         {
//           _id: roomId,
//         },
//         {
//           room_deck: deck,
//         },
//         (err, room) => {
//           if (!err) {
//             // for (let i = 0; i < 5; i++) {
//             //   playerCards.push({
//             //     skipCount: 0,
//             //     cards: [
//             //       deck.shift(),
//             //       deck.shift(),
//             //       deck.shift(),
//             //       deck.shift(),
//             //       deck.shift(),
//             //     ],
//             //   });
//             // }
//             let roomRoster = io.sockets.adapter.rooms.get(roomId);
//             roomRoster.forEach(function (client) {
//               io.to(roomId).emit('deck', {
//                 skipCount: 0,
//                 cards: [
//                   deck.shift(),
//                   deck.shift(),
//                   deck.shift(),
//                   deck.shift(),
//                   deck.shift(),
//                 ],
//                 //this is the socket of each client in the room.
//                 //const clientSocket = io.sockets.sockets.get(client.id);
//               });
//               console.log('Username: ' + client.data.uuid);
//             });
//           }
//         }
//       );
//     }
//   }
// );

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
                  if (success.room_playerLength >= 1) restartCountDown();
                });
              }
            );
          }
        }
      );
    }
  });

  socket.on('dropCards', (droppedCards) => {
    Room.findOneAndUpdate(
      {
        _id: socket.data.roomId,
        'room_players.uuid': socket.data.uuid,
      },
      {
        $pop: { room_deck: -droppedCards.length },
        $pullAll: { 'room_players.$.cards': droppedCards },
      },
      { new: true },
      (err, room) => {
        if (!err) io.to(room._id).emit('dropCards', room);
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
      console.log('Game has started');
      roomRoster.forEach(async function (client, i) {
        // this is the socket of each client in the room.
        const clientSocket = io.sockets.sockets.get(client);
        // if (i === 0) {
        //   dealerId = clientSocket.data.uuid;
        // }
        let playerDeck = [
          deck[i * 5],
          deck[i * 5 + 1],
          deck[i * 5 + 2],
          deck[i * 5 + 3],
          deck[i * 5 + 4],
        ];
        await Room.findOneAndUpdate(
          {
            _id: socket.data.roomId,
            'room_players.uuid': clientSocket.data.uuid,
          },
          {
            'room_players.$.cards': playerDeck,
          },
          { new: true },
          (err, room) => {
            console.log(
              'Username: ' + clientSocket.data.name,
              clientSocket.data.uuid,
              playerDeck
            );
          }
        );
      });
      Room.findOneAndUpdate(
        {
          _id: socket.data.roomId,
        },
        {
          room_deck: deck.slice(25),
          room_dealer: io.sockets.sockets.get(roomRoster[0]).data.uuid,
          room_isPlaying: true,
        },
        { new: true },
        (err, room) => {
          if (!err) io.to(room._id).emit('startGame', room);
        }
      );
    }, 1000);
  }
});

http.listen(PORT, function () {
  console.log(`Server started! http://localhost:${PORT}/`);
});
