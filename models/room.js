import mongoose from 'mongoose';
import { Schema } from mongoose;

const roomSchema = new Schema({
  _id: { type: Number, default: 100000, required: true },
  room_isPlaying: {type: Boolean,  default: false},
  room_deck: Array,
  room_players: Array,
  room_created: { type: Date, default: Date.now }
});
module.exports = mongoose.model('rooms', roomSchema);