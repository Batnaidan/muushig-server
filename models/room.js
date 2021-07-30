const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const roomSchema = new Schema({
  _id: { type: Number, default: 100000, required: true },
  room_isPlaying: { type: Boolean, default: false },
  room_deck: { type: Array, default: [] },
  room_players: {
    type: Array,
    default: [],
  },
  room_created: { type: Date, default: Date.now },
  room_playerLength: { type: Number, default: 0 },
});
module.exports = mongoose.model('rooms', roomSchema);
