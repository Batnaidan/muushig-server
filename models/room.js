const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const roomSchema = new Schema({
  _id: { type: Number, default: 100000, required: true },
  room_isPlaying: { type: Boolean, default: false },
  room_stage: { type: String, default: 'ready' },
  room_dealer: { type: Number, default: 0 },
  room_deck: { type: Array, default: [] },
  room_players: {
    type: Array,
    default: [],
  },
  room_turn: { type: String, default: '' },
  room_readyPlayerCount: { type: Number, default: 0 },
  room_specialCard: { type: String, default: '' },
  room_created: { type: Date, default: Date.now },
  room_playerLength: { type: Number, default: 0 },
  room_currentCards: { type: Array, default: [] },
  room_currentCardLeader: { type: String, default: '' },
});
module.exports = mongoose.model('rooms', roomSchema);
