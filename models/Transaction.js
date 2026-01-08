const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  type: {
    type: String,
    enum: ['buy', 'sell'],
    required: true,
  },
  cryptoType: {
    type: String,
    enum: ['BTC', 'ETH', 'USDT'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  rate: {
    type: Number,
    required: true,
    min: 0,
  },
  fiatAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  status: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'CANCELLED', 'REJECTED'],
    default: 'PENDING',
  },
  paymentProof: {
    type: String, // file_id from Telegram (for buy)
  },
  txHash: {
    type: String, // transaction hash (for sell)
  },
  screenshot: {
    type: String, // file_id from Telegram (for sell)
  },  giftType: {
    type: String, // Amazon, Apple, Google Play, Steam
  },
  cardValue: {
    type: Number, // gift card face value
  },
  country: {
    type: String, // country code like USD, EUR
  },
  cardImage: {
    type: String, // file_id for card image
  },
  cardCode: {
    type: String, // text code for the card
  },
  paymentDetails: {
    type: String, // user's bank/wallet details for payment
  },
  rejectReason: {
    type: String, // reason for rejection
  },  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update updatedAt on save
TransactionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Transaction', TransactionSchema);