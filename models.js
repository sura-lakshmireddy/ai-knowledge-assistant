const mongoose = require('mongoose');
const { Schema } = mongoose;

const User = mongoose.model('User', new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  points: { type: Number, default: 0 },
  testsTaken: { type: Number, default: 0 },
  badges: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
}));

const Doc = mongoose.model('Doc', new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  filename: String,
  mimetype: String,
  size: Number,
  text: String,                                   // extracted content
  file: { type: Buffer, select: false },          // original file stored in MongoDB
  createdAt: { type: Date, default: Date.now }
}));

const Test = mongoose.model('Test', new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  doc: { type: Schema.Types.ObjectId, ref: 'Doc' },
  title: String,
  questions: [{ q: String, options: [String], answer: Number, explanation: String }],
  submitted: { type: Boolean, default: false },
  score: Number,
  pointsEarned: Number,
  createdAt: { type: Date, default: Date.now }
}));

module.exports = { User, Doc, Test };
