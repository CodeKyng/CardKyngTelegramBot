// Admin-defined rates for cryptocurrencies (in USD)
const cryptoRates = {
  BTC: 50000, // $50,000 per BTC
  ETH: 3000,  // $3,000 per ETH
  USDT: 1,    // $1 per USDT (stable coin)
};

// Gift card payout rates (percentage of face value)
const giftCardRates = {
  Amazon: 0.85,      // 85% payout
  Apple: 0.80,       // 80% payout
  'Google Play': 0.82, // 82% payout
  Steam: 0.88,       // 88% payout
};

module.exports = { cryptoRates, giftCardRates };