const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  cryptoRates: {
    BTC: { type: Number, default: 50000 },
    ETH: { type: Number, default: 3000 },
    USDT: { type: Number, default: 1 }
  },
  giftCardRates: {
    Amazon: { type: Number, default: 0.85 },
    Apple: { type: Number, default: 0.80 },
    'Google Play': { type: Number, default: 0.82 },
    Steam: { type: Number, default: 0.88 }
  },
  wallets: {
    BTC: { type: String, default: '' },
    ETH: { type: String, default: '' },
    USDT: { type: String, default: '' }
  },
  updatedBy: {
    type: String, // admin telegram id
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Ensure only one settings document
SettingsSchema.pre('save', async function(next) {
  const count = await mongoose.model('Settings').countDocuments();
  if (count > 0 && !this.isNew) {
    next();
  } else if (count > 0 && this.isNew) {
    throw new Error('Only one settings document allowed');
  } else {
    next();
  }
});

module.exports = mongoose.model('Settings', SettingsSchema);