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
    origin: [
      'https://localhost:8080',
      'https://apps-967075340802214.apps.fbsbx.com',
    ],
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
          if (room.room_playerLength >= 2) restartRound();
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
            if (room.room_playerLength >= 2) restartRound();
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
                  if (success.room_playerLength >= 2) restartRound();
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
        if (isReady) {
          room.room_readyPlayerCount += 1;
          room.room_readyPlayers.push(socket.data.uuid);
        }
        if (!isReady) room.room_players[playerIndex].skipCount += 1;
        room.markModified('room_players');
        room.save((err, result) => {
          if (!err) io.to(room._id).emit('changeReady', result);
        });
      }
    );
  });
  socket.on('changeCards', (droppedCards) => {
    Room.findOne(
      {
        _id: socket.data.roomId,
      },
      (err, room) => {
        if (room.room_stage != 'change') return;
        const isMe = (element) => element.uuid == socket.data.uuid;
        playerIndex = room.room_players.findIndex(isMe);

        droppedCards.forEach((card) => {
          let i = room.room_players[playerIndex].cards.indexOf(card);
          room.room_players[playerIndex].cards.splice(i, 1);
        });
        let swapCards = room.room_deck.splice(0, droppedCards.length);
        room.room_players[playerIndex].cards.push(...swapCards);
        let readyPlayerIndex = room.room_readyPlayers.indexOf(socket.data.uuid);
        if (room.room_readyPlayerCount == readyPlayerIndex + 1) {
          if (room.room_players[room.room_dealer].ready) {
            room.room_turn = room.room_players[room.room_dealer].uuid;
            room.room_stage = 'changeDealerCard';
          } else {
            room.room_turn = room.readyPlayers[0];
            room.room_stage = 'put';
          }
        } else {
          for (
            playerIndex += 1;
            playerIndex < room.room_playerLength;
            playerIndex++
          ) {
            if (room.room_players[playerIndex].ready == true) {
              room.room_turn = room.room_players[playerIndex].uuid;
              break;
            }
          }
        }
        room.markModified('room_players');
        room.save((err, result) => {
          if (!err) io.to(room._id).emit('changeCards', result);
        });
      }
    );
  });
  socket.on('changeDealerCard', (droppedCard) => {
    Room.findOne(
      {
        _id: socket.data.roomId,
      },
      (err, room) => {
        let i = room.room_players[room.room_dealer].cards.indexOf(
          droppedCard[0]
        );
        room.room_players[room.room_dealer].cards.splice(i, 1);
        room.room_players[room.room_dealer].cards.push(room.room_specialCard);

        let j = 0;
        for (; j < room.room_playerLength; j++) {
          if (room.room_players[j].ready == true) {
            room.room_turn = room.room_players[j].uuid;
            break;
          }
        }
        room.room_stage = 'put';
        room.markModified('room_players');
        room.save((err, result) => {
          if (!err) io.to(result._id).emit('changeCards', result);
          console.log('changeDealerCard');
        });
      }
    );
  });
  socket.on('putCards', (putCard) => {
    Room.findOne(
      {
        _id: socket.data.roomId,
      },
      (err, room) => {
        if (room.room_stage != 'put') return;
        let specialCardType =
          room.room_specialCard[room.room_specialCard.length - 1];
        let putCardType = putCard[putCard.length - 1];
        let putCardRank = parseInt(putCard.slice(0, putCard.length - 1));
        if (room.room_currentCards.length == 0) {
          room.room_currentCards.push(putCard);
          room.room_currentCardLeader = socket.data.uuid;
        } else {
          let currentCard =
            room.room_currentCards[room.room_currentCards.length - 1];
          let currentCardType = currentCard[currentCard.length - 1];
          let currentCardRank = parseInt(
            currentCard.slice(0, currentCard.length - 1)
          );
          if (
            putCardType == specialCardType &&
            currentCardType == specialCardType
          ) {
            if (putCardRank > currentCardRank) {
              room.room_currentCards.push(putCard);
              room.room_currentCardLeader = socket.data.uuid;
            } else {
              room.room_currentCards.unshift(putCard);
            }
          } else if (
            putCardType == specialCardType &&
            currentCardType != specialCardType
          ) {
            room.room_currentCards.push(putCard);
            room.room_currentCardLeader = socket.data.uuid;
          } else if (
            putCardType != specialCardType &&
            currentCardType != specialCardType
          ) {
            if (putCardRank > currentCardRank) {
              room.room_currentCards.push(putCard);
              room.room_currentCardLeader = socket.data.uuid;
            } else {
              room.room_currentCards.unshift(putCard);
            }
          } else if (
            putCardType != specialCardType &&
            currentCardType == specialCardType
          ) {
            room.room_currentCards.unshift(putCard);
          }
        }
        const isMe = (element) => element.uuid == socket.data.uuid;
        playerIndex = room.room_players.findIndex(isMe);
        let i = room.room_players[playerIndex].cards.indexOf(putCard);
        room.room_players[playerIndex].cards.splice(i, 1);

        if (room.room_readyPlayerCount == room.room_currentCards.length) {
          console.log('if');
          room.room_players.forEach((player) => {
            if (player.uuid == room.room_currentCardLeader) {
              player.score -= 1;
            }
          });
          room.room_prevCards = room.room_currentCards;
          room.room_currentCards = [];
          room.room_turn = room.room_currentCardLeader;
          room.room_currentCardLeader = '';
          room.markModified('room_currentCards');
          room.markModified('room_players');
          room.markModified('room_prevCards');
          room.save((err, result) => {
            if (!err) io.to(result._id).emit('roundOver', result);
            console.log('roundOver', result.room_prevCards);
            if (result.room_players[0].cards.length == 0) {
              result.room_players.forEach((players, i) => {
                if (players.score <= 0) {
                  io.to(result._id).emit('matchEnd', result);
                }
              });
            }
          });
        } else {
          if (playerIndex + 1 == room.room_playerLength) {
            playerIndex = 0;
          } else {
            playerIndex += 1;
          }
          for (; playerIndex < room.room_playerLength; playerIndex++) {
            if (room.room_players[playerIndex].ready == true) {
              room.room_turn = room.room_players[playerIndex].uuid;
              break;
            }
          }
          room.markModified('room_currentCards');
          room.markModified('room_players');
          room.save((err, result) => {
            if (!err) io.to(result._id).emit('putCards', result);
            console.log('put', result.room_currentCards);
          });
        }
      }
    );
  });
  socket.on('disconnecting', () => {
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

  function restartRound() {
    if (timeOut) clearTimeout(timeOut);

    timeOut = setTimeout(function () {
      deck = shuffleCards();
      let roomRoster = io.sockets.adapter.rooms.get(socket.data.roomId);
      roomRoster = [...roomRoster];
      console.log('Game has started', socket.data.roomId);
      Room.findOne({ _id: socket.data.roomId }, (err, room) => {
        if (!err) {
          for (let i = 0; i < room.room_players.length; i++) {
            room.room_players[i].cards = [
              deck[i * 5],
              deck[i * 5 + 1],
              deck[i * 5 + 2],
              deck[i * 5 + 3],
              deck[i * 5 + 4],
            ];
          }
          room.room_stage = 'ready';
          room.room_players.push(room.room_players.shift()); //shift first player to the last to make him dealer
          room.room_specialCard = deck[25];
          room.room_deck = deck.slice(26);
          room.room_dealer = room.room_playerLength - 1;
          room.room_isPlaying = true;
          room.room_turn = room.room_players[0].uuid;
          room.markModified('room_players');
          room.save((err, result) => {
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
