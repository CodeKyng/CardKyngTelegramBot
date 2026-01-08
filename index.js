const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const connectDB = require('./db');
const User = require('./models/User');
const Transaction = require('./models/Transaction');
const Settings = require('./models/Settings');

// Global settings object
let globalSettings = {
  cryptoRates: { BTC: 50000, ETH: 3000, USDT: 1 },
  giftCardRates: { Amazon: 0.85, Apple: 0.80, 'Google Play': 0.82, Steam: 0.88 },
  wallets: { BTC: process.env.WALLET_BTC || '', ETH: process.env.WALLET_ETH || '', USDT: process.env.WALLET_USDT || '' }
};

// Load settings from DB
async function loadSettings() {
  try {
    const settings = await Settings.findOne();
    if (settings) {
      globalSettings = {
        cryptoRates: settings.cryptoRates,
        giftCardRates: settings.giftCardRates,
        wallets: settings.wallets
      };
    } else {
      // Create default settings
      const defaultSettings = new Settings(globalSettings);
      await defaultSettings.save();
    }
    console.log('Settings loaded from database');
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

connectDB().then(() => {
  loadSettings();
});

// User state management for flows
const userStates = new Map();
// Admin state management for rejection reasons
const adminStates = new Map();

// Security features
const userMessageCounts = new Map(); // chatId -> { count, resetTime }
const RATE_LIMIT = 10; // messages per minute
const RATE_WINDOW = 60 * 1000; // 1 minute

// Input validation functions
function validateAmount(amount) {
  const num = parseFloat(amount);
  return !isNaN(num) && num > 0 && num <= 1000000; // Max 1M
}

function validateCryptoType(type) {
  return ['BTC', 'ETH', 'USDT'].includes(type);
}

function validateGiftCardType(type) {
  return ['Amazon', 'Apple', 'Google Play', 'Steam'].includes(type);
}

function sanitizeText(text) {
  if (!text) return '';
  // Remove potential script tags and limit length
  return text.replace(/<[^>]*>/g, '').substring(0, 1000);
}

function checkRateLimit(chatId) {
  const now = Date.now();
  const userData = userMessageCounts.get(chatId) || { count: 0, resetTime: now + RATE_WINDOW };

  if (now > userData.resetTime) {
    userData.count = 0;
    userData.resetTime = now + RATE_WINDOW;
  }

  if (userData.count >= RATE_LIMIT) {
    return false; // Rate limited
  }

  userData.count++;
  userMessageCounts.set(chatId, userData);
  return true;
}

function validateFileUpload(msg) {
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'text/plain'
  ];

  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    if (photo.file_size > MAX_FILE_SIZE) return false;
    return true; // Telegram photos are validated
  }

  if (msg.document) {
    if (msg.document.file_size > MAX_FILE_SIZE) return false;
    if (msg.document.mime_type && !ALLOWED_MIME_TYPES.includes(msg.document.mime_type)) return false;
    return true;
  }

  return false;
}

// Transaction history helper function
async function showTransactionHistory(chatId, page = 1) {
  const ITEMS_PER_PAGE = 5;
  const skip = (page - 1) * ITEMS_PER_PAGE;

  try {
    const user = await User.findOne({ telegramId: chatId.toString() });
    if (!user) {
      bot.sendMessage(chatId, 'User not found. Please restart with /start.');
      return;
    }

    const totalTransactions = await Transaction.countDocuments({ user: user._id });
    const transactions = await Transaction.find({ user: user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(ITEMS_PER_PAGE);

    if (transactions.length === 0) {
      bot.sendMessage(chatId, 'No transactions found.', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Back to Main Menu', callback_data: 'main_menu' }]]
        }
      });
      return;
    }

    let message = `📊 Your Transaction History (Page ${page})\n\n`;
    transactions.forEach((tx, index) => {
      const txNumber = skip + index + 1;
      const date = tx.createdAt.toLocaleDateString();
      let type = tx.type;
      let details = '';

      if (tx.type === 'buy') {
        type = `Buy ${tx.cryptoType}`;
        details = `Amount: ${tx.amount} ${tx.cryptoType}\nTotal: $${tx.fiatAmount}`;
      } else if (tx.type === 'sell') {
        type = `Sell ${tx.cryptoType}`;
        details = `Amount: ${tx.amount} ${tx.cryptoType}`;
      } else if (tx.type === 'sell_gift_card') {
        type = `Sell ${tx.giftType} Gift Card`;
        details = `Value: $${tx.cardValue} ${tx.country}\nPayout: $${tx.fiatAmount}`;
      }

      const statusEmoji = tx.status === 'COMPLETED' ? '✅' : tx.status === 'REJECTED' ? '❌' : '⏳';
      message += `${txNumber}. ${statusEmoji} ${type}\n`;
      message += `   ${details}\n`;
      message += `   Date: ${date}\n`;
      message += `   ID: ${tx._id}\n\n`;
    });

    const totalPages = Math.ceil(totalTransactions / ITEMS_PER_PAGE);
    const keyboard = [];

    // Navigation buttons
    const navRow = [];
    if (page > 1) {
      navRow.push({ text: '⬅️ Previous', callback_data: `history_page_${page - 1}` });
    }
    if (page < totalPages) {
      navRow.push({ text: 'Next ➡️', callback_data: `history_page_${page + 1}` });
    }
    if (navRow.length > 0) {
      keyboard.push(navRow);
    }

    // Back to main menu
    keyboard.push([{ text: 'Back to Main Menu', callback_data: 'main_menu' }]);

    const opts = {
      reply_markup: {
        inline_keyboard: keyboard
      }
    };

    bot.sendMessage(chatId, message, opts);
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    bot.sendMessage(chatId, 'An error occurred while fetching your transaction history.');
  }
}

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name || 'Unknown';

  const opts = {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Buy Crypto', callback_data: 'buy_crypto' }],
        [{ text: 'Sell Crypto', callback_data: 'sell_crypto' }],
        [{ text: 'Sell Gift Cards', callback_data: 'sell_gift_cards' }],
        [{ text: 'Transaction History', callback_data: 'transaction_history' }],
        [{ text: 'Help', callback_data: 'help' }]
      ]
    }
  };

  // Save user to database
  try {
    await User.findOneAndUpdate(
      { telegramId: chatId.toString() },
      { username: username },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`User ${username} (${chatId}) saved/updated`);
  } catch (error) {
    console.error('Error saving user:', error);
  }

  bot.sendMessage(chatId, 'Welcome to CardKyng Telegram Bot!', opts);
});

// Handler functions for menu navigation
const handlers = {
  buy_crypto: async (query) => {
    const chatId = query.message.chat.id;
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Bitcoin (BTC)', callback_data: 'buy_btc' }],
          [{ text: 'Ethereum (ETH)', callback_data: 'buy_eth' }],
          [{ text: 'Tether (USDT)', callback_data: 'buy_usdt' }],
          [{ text: 'Back to Main Menu', callback_data: 'main_menu' }]
        ]
      }
    };
    bot.sendMessage(chatId, 'Choose cryptocurrency to buy:', opts);
  },

  sell_crypto: async (query) => {
    const chatId = query.message.chat.id;
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Bitcoin (BTC)', callback_data: 'sell_btc' }],
          [{ text: 'Ethereum (ETH)', callback_data: 'sell_eth' }],
          [{ text: 'Tether (USDT)', callback_data: 'sell_usdt' }],
          [{ text: 'Back to Main Menu', callback_data: 'main_menu' }]
        ]
      }
    };
    bot.sendMessage(chatId, 'Choose cryptocurrency to sell:', opts);
  },

  sell_gift_cards: async (query) => {
    const chatId = query.message.chat.id;
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Amazon Gift Card', callback_data: 'sell_amazon' }],
          [{ text: 'Apple Gift Card', callback_data: 'sell_apple' }],
          [{ text: 'Google Play Gift Card', callback_data: 'sell_google' }],
          [{ text: 'Steam Gift Card', callback_data: 'sell_steam' }],
          [{ text: 'Back to Main Menu', callback_data: 'main_menu' }]
        ]
      }
    };
    bot.sendMessage(chatId, 'Choose gift card type to sell:', opts);
  },

  help: async (query) => {
    const chatId = query.message.chat.id;
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Back to Main Menu', callback_data: 'main_menu' }]
        ]
      }
    };
    bot.sendMessage(chatId, 'Welcome to CardKyng Bot!\n\nHere you can:\n- Buy and sell cryptocurrencies\n- Sell gift cards\n\nContact support for more help.', opts);
  },

  main_menu: async (query) => {
    const chatId = query.message.chat.id;
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
    const isAdmin = adminIds.includes(query.from.id.toString());

    const keyboard = [
      [{ text: 'Buy Crypto', callback_data: 'buy_crypto' }],
      [{ text: 'Sell Crypto', callback_data: 'sell_crypto' }],
      [{ text: 'Sell Gift Cards', callback_data: 'sell_gift_cards' }],
      [{ text: 'Transaction History', callback_data: 'transaction_history' }],
      [{ text: 'Help', callback_data: 'help' }]
    ];

    if (isAdmin) {
      keyboard.splice(4, 0, [{ text: 'Admin Panel', callback_data: 'admin_panel' }]);
    }

    const opts = {
      reply_markup: {
        inline_keyboard: keyboard
      }
    };
    bot.sendMessage(chatId, 'Welcome back to CardKyng Telegram Bot!', opts);
  },

  transaction_history: async (query) => {
    const chatId = query.message.chat.id;
    await showTransactionHistory(chatId, 1);
  },

  admin_panel: async (query) => {
    const chatId = query.message.chat.id;
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Set Crypto Rates', callback_data: 'set_crypto_rates' }],
          [{ text: 'Set Gift Card Rates', callback_data: 'set_gift_card_rates' }],
          [{ text: 'Update Wallet Addresses', callback_data: 'update_wallets' }],
          [{ text: 'Back to Main Menu', callback_data: 'main_menu' }]
        ]
      }
    };
    bot.sendMessage(chatId, 'Admin Panel - Choose an option:', opts);
  },

  set_crypto_rates: async (query) => {
    const chatId = query.message.chat.id;
    adminStates.set(chatId, { state: 'setting_crypto_rates', step: 'btc', rates: {} });
    bot.sendMessage(chatId, 'Enter the new BTC rate (in USD):');
  },

  set_gift_card_rates: async (query) => {
    const chatId = query.message.chat.id;
    adminStates.set(chatId, { state: 'setting_gift_rates', step: 'amazon', rates: {} });
    bot.sendMessage(chatId, 'Enter the new Amazon gift card payout rate (e.g., 0.85 for 85%):');
  },

  update_wallets: async (query) => {
    const chatId = query.message.chat.id;
    adminStates.set(chatId, { state: 'updating_wallets', step: 'btc', wallets: {} });
    bot.sendMessage(chatId, 'Enter the new BTC wallet address:');
  },

  // Buy crypto flow handlers
  buy_btc: async (query) => {
    const chatId = query.message.chat.id;
    userStates.set(chatId, { state: 'waiting_amount', cryptoType: 'BTC', type: 'buy' });
    bot.sendMessage(chatId, 'Enter the amount of Bitcoin (BTC) you want to buy:');
  },

  buy_eth: async (query) => {
    const chatId = query.message.chat.id;
    userStates.set(chatId, { state: 'waiting_amount', cryptoType: 'ETH', type: 'buy' });
    bot.sendMessage(chatId, 'Enter the amount of Ethereum (ETH) you want to buy:');
  },

  buy_usdt: async (query) => {
    const chatId = query.message.chat.id;
    userStates.set(chatId, { state: 'waiting_amount', cryptoType: 'USDT', type: 'buy' });
    bot.sendMessage(chatId, 'Enter the amount of Tether (USDT) you want to buy:');
  },

  sell_btc: async (query) => {
    const chatId = query.message.chat.id;
    userStates.set(chatId, { state: 'waiting_amount_sell', cryptoType: 'BTC', type: 'sell' });
    bot.sendMessage(chatId, 'Enter the amount of Bitcoin (BTC) you want to sell:');
  },

  sell_eth: async (query) => {
    const chatId = query.message.chat.id;
    userStates.set(chatId, { state: 'waiting_amount_sell', cryptoType: 'ETH', type: 'sell' });
    bot.sendMessage(chatId, 'Enter the amount of Ethereum (ETH) you want to sell:');
  },

  sell_usdt: async (query) => {
    const chatId = query.message.chat.id;
    userStates.set(chatId, { state: 'waiting_amount_sell', cryptoType: 'USDT', type: 'sell' });
    bot.sendMessage(chatId, 'Enter the amount of Tether (USDT) you want to sell:');
  },

  sell_amazon: async (query) => {
    const chatId = query.message.chat.id;
    userStates.set(chatId, { state: 'waiting_gift_details', giftType: 'Amazon' });
    bot.sendMessage(chatId, 'Enter the gift card value and country (e.g., "50 USD" or "100 EUR"). Type "cancel" to cancel.');
  },

  sell_apple: async (query) => {
    const chatId = query.message.chat.id;
    userStates.set(chatId, { state: 'waiting_gift_details', giftType: 'Apple' });
    bot.sendMessage(chatId, 'Enter the gift card value and country (e.g., "50 USD" or "100 EUR"). Type "cancel" to cancel.');
  },

  sell_google: async (query) => {
    const chatId = query.message.chat.id;
    userStates.set(chatId, { state: 'waiting_gift_details', giftType: 'Google Play' });
    bot.sendMessage(chatId, 'Enter the gift card value and country (e.g., "50 USD" or "100 EUR"). Type "cancel" to cancel.');
  },

  sell_steam: async (query) => {
    const chatId = query.message.chat.id;
    userStates.set(chatId, { state: 'waiting_gift_details', giftType: 'Steam' });
    bot.sendMessage(chatId, 'Enter the gift card value and country (e.g., "50 USD" or "100 EUR"). Type "cancel" to cancel.');
  }
};

// Handle callback queries
bot.on('callback_query', async (query) => {
  const action = query.data;
  const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
  const isAdmin = adminIds.includes(query.from.id.toString());

  if (handlers[action]) {
    try {
      await handlers[action](query);
    } catch (error) {
      console.error('Error handling callback:', error);
    }
  } else if (action.startsWith('approve_') && isAdmin) {
    const txId = action.split('_')[1];
    try {
      const transaction = await Transaction.findById(txId).populate('user');
      if (!transaction || transaction.status !== 'PENDING') {
        bot.answerCallbackQuery(query.id, { text: 'Transaction not found or already processed.' });
        return;
      }

      // Ask user for payment details
      userStates.set(transaction.user.telegramId, { state: 'waiting_payment_details', txId });
      bot.sendMessage(transaction.user.telegramId, 'Your transaction has been approved! Please provide your bank account details or wallet address for payment.');

      bot.answerCallbackQuery(query.id, { text: 'Approval initiated. User notified.' });
    } catch (error) {
      console.error('Error approving transaction:', error);
      bot.answerCallbackQuery(query.id, { text: 'Error processing approval.' });
    }
  } else if (action.startsWith('reject_') && isAdmin) {
    const txId = action.split('_')[1];
    adminStates.set(query.from.id, { state: 'waiting_reject_reason', txId });
    bot.sendMessage(query.from.id, 'Please provide the reason for rejection:');
    bot.answerCallbackQuery(query.id, { text: 'Rejection initiated. Please provide reason.' });
  } else if (action.startsWith('history_page_')) {
    const page = parseInt(action.split('_')[2]);
    if (page && page > 0) {
      await showTransactionHistory(query.from.id, page);
    }
    return; // Don't answer callback for history pages
  } else if (!isAdmin && (action.startsWith('approve_') || action.startsWith('reject_'))) {
    bot.answerCallbackQuery(query.id, { text: 'Unauthorized access.' });
  }

  bot.answerCallbackQuery(query.id);
});

// Handle text messages for amount input
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Rate limiting
  if (!checkRateLimit(chatId)) {
    return; // Silently ignore rate limited messages
  }

  const userState = userStates.get(chatId);

  if (userState && (userState.state === 'waiting_amount' || userState.state === 'waiting_amount_sell') && msg.text) {
    if (msg.text.toLowerCase() === 'cancel') {
      userStates.delete(chatId);
      bot.sendMessage(chatId, 'Transaction cancelled. Returning to main menu.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Buy Crypto', callback_data: 'buy_crypto' }],
            [{ text: 'Sell Crypto', callback_data: 'sell_crypto' }],
            [{ text: 'Sell Gift Cards', callback_data: 'sell_gift_cards' }],
            [{ text: 'Help', callback_data: 'help' }]
          ]
        }
      });
      return;
    }

    const sanitizedText = sanitizeText(msg.text);
    const amount = parseFloat(sanitizedText);
    if (!validateAmount(sanitizedText)) {
      bot.sendMessage(chatId, 'Please enter a valid positive number for the amount (max 1,000,000). Type "cancel" to cancel.');
      return;
    }

    const { cryptoType, type } = userState;

    if (type === 'sell') {
      // For sell, show wallet address
      const walletAddress = globalSettings.wallets[cryptoType];
      if (!walletAddress) {
        bot.sendMessage(chatId, 'Wallet address not configured. Please contact support.');
        userStates.delete(chatId);
        return;
      }

      userStates.set(chatId, {
        state: 'waiting_tx_sell',
        cryptoType,
        type,
        amount
      });

      bot.sendMessage(
        chatId,
        `Please send ${amount} ${cryptoType} to the following wallet address:\n\n` +
        `${walletAddress}\n\n` +
        `After sending, please submit your transaction hash or upload a screenshot of the transaction. Type "cancel" to cancel.`
      );
    } else {
      // For buy, calculate price and ask for payment proof
      const rate = globalSettings.cryptoRates[cryptoType];
      const fiatAmount = amount * rate;

      userStates.set(chatId, {
        state: 'waiting_proof',
        cryptoType,
        type,
        amount,
        rate,
        fiatAmount
      });

      bot.sendMessage(
        chatId,
        `Transaction Details:\n` +
        `Cryptocurrency: ${cryptoType}\n` +
        `Amount: ${amount} ${cryptoType}\n` +
        `Rate: $${rate} per ${cryptoType}\n` +
        `Total to Pay: $${fiatAmount}\n\n` +
        `Please upload your payment proof (photo or document). Type "cancel" to cancel.`
      );
    }
  }
});

// Handle photo/document uploads for payment proof
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userState = userStates.get(chatId);

  if (userState && userState.state === 'waiting_proof') {
    if (msg.text && msg.text.toLowerCase() === 'cancel') {
      userStates.delete(chatId);
      bot.sendMessage(chatId, 'Transaction cancelled. Returning to main menu.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Buy Crypto', callback_data: 'buy_crypto' }],
            [{ text: 'Sell Crypto', callback_data: 'sell_crypto' }],
            [{ text: 'Sell Gift Cards', callback_data: 'sell_gift_cards' }],
            [{ text: 'Help', callback_data: 'help' }]
          ]
        }
      });
      return;
    }

    let fileId = null;
    if (msg.photo && msg.photo.length > 0) {
      fileId = msg.photo[msg.photo.length - 1].file_id; // Get the highest resolution
    } else if (msg.document) {
      fileId = msg.document.file_id;
    }

    if (!validateFileUpload(msg)) {
      bot.sendMessage(chatId, 'Invalid file. Please upload a valid image (max 10MB) or document. Type "cancel" to cancel.');
      return;
    }

    try {
      // Find user
      const user = await User.findOne({ telegramId: chatId.toString() });
      if (!user) {
        bot.sendMessage(chatId, 'User not found. Please restart with /start.');
        userStates.delete(chatId);
        return;
      }

      // Check for duplicate pending transactions
      const existingTransaction = await Transaction.findOne({
        user: user._id,
        type: userState.type,
        status: 'PENDING'
      });

      if (existingTransaction) {
        bot.sendMessage(chatId, 'You already have a pending transaction of this type. Please wait for it to be processed or contact support.');
        userStates.delete(chatId);
        return;
      }

      // Create transaction
      const transaction = new Transaction({
        user: user._id,
        type: userState.type,
        cryptoType: userState.cryptoType,
        amount: userState.amount,
        rate: userState.rate,
        fiatAmount: userState.fiatAmount,
        paymentProof: fileId,
        status: 'PENDING'
      });

      await transaction.save();

      bot.sendMessage(
        chatId,
        `✅ Transaction created successfully!\n\n` +
        `Transaction ID: ${transaction._id}\n` +
        `Status: PENDING\n\n` +
        `Your transaction is being reviewed. You will be notified once it's processed.`
      );

      // Clear user state
      userStates.delete(chatId);

    } catch (error) {
      console.error('Error saving transaction:', error);
      bot.sendMessage(chatId, 'An error occurred while processing your transaction. Please try again.');
      userStates.delete(chatId);
    }
  }
});

// Handle text/photo/document for sell transaction submission
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userState = userStates.get(chatId);

  if (userState && userState.state === 'waiting_tx_sell') {
    if (msg.text && msg.text.toLowerCase() === 'cancel') {
      userStates.delete(chatId);
      bot.sendMessage(chatId, 'Transaction cancelled. Returning to main menu.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Buy Crypto', callback_data: 'buy_crypto' }],
            [{ text: 'Sell Crypto', callback_data: 'sell_crypto' }],
            [{ text: 'Sell Gift Cards', callback_data: 'sell_gift_cards' }],
            [{ text: 'Help', callback_data: 'help' }]
          ]
        }
      });
      return;
    }

    let txHash = null;
    let screenshot = null;

    if (msg.text && !msg.text.startsWith('/')) {
      txHash = sanitizeText(msg.text);
    } else if (msg.photo || msg.document) {
      if (!validateFileUpload(msg)) {
        bot.sendMessage(chatId, 'Invalid file. Please upload a valid image (max 10MB) or enter transaction hash. Type "cancel" to cancel.');
        return;
      }
      if (msg.photo && msg.photo.length > 0) {
        screenshot = msg.photo[msg.photo.length - 1].file_id;
      } else if (msg.document) {
        screenshot = msg.document.file_id;
      }
    }

    if (!txHash && !screenshot) {
      bot.sendMessage(chatId, 'Please send your transaction hash as text or upload a screenshot. Type "cancel" to cancel.');
      return;
    }

    try {
      // Find user
      const user = await User.findOne({ telegramId: chatId.toString() });
      if (!user) {
        bot.sendMessage(chatId, 'User not found. Please restart with /start.');
        userStates.delete(chatId);
        return;
      }

      // Check for duplicate pending transactions
      const existingTransaction = await Transaction.findOne({
        user: user._id,
        type: userState.type,
        status: 'PENDING'
      });

      if (existingTransaction) {
        bot.sendMessage(chatId, 'You already have a pending transaction of this type. Please wait for it to be processed or contact support.');
        userStates.delete(chatId);
        return;
      }

      // Create transaction
      const transaction = new Transaction({
        user: user._id,
        type: userState.type,
        cryptoType: userState.cryptoType,
        amount: userState.amount,
        rate: 0, // Not used for sell
        fiatAmount: 0, // Not used for sell
        txHash,
        screenshot,
        status: 'PENDING'
      });

      await transaction.save();

      bot.sendMessage(
        chatId,
        `✅ Sell transaction submitted successfully!\n\n` +
        `Transaction ID: ${transaction._id}\n` +
        `Status: PENDING\n\n` +
        `Your transaction is being reviewed. You will be notified once it's processed.`
      );

      // Notify admin
      const adminChatId = process.env.ADMIN_CHAT_ID;
      if (adminChatId) {
        const adminMessage = `🔔 New Sell Transaction Submitted!\n\n` +
          `User: ${user.username} (${user.telegramId})\n` +
          `Type: Sell ${userState.cryptoType}\n` +
          `Amount: ${userState.amount} ${userState.cryptoType}\n` +
          `Transaction ID: ${transaction._id}\n` +
          `${txHash ? `TX Hash: ${txHash}` : ''}\n` +
          `${screenshot ? `Screenshot: ${screenshot}` : ''}`;

        const opts = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Approve', callback_data: `approve_${transaction._id}` }],
              [{ text: '❌ Reject', callback_data: `reject_${transaction._id}` }]
            ]
          }
        };

        bot.sendMessage(adminChatId, adminMessage, opts);
      }

      // Clear user state
      userStates.delete(chatId);

    } catch (error) {
      console.error('Error saving sell transaction:', error);
      bot.sendMessage(chatId, 'An error occurred while processing your transaction. Please try again.');
      userStates.delete(chatId);
    }
  }
});

// Handle gift card details input
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userState = userStates.get(chatId);

  if (userState && userState.state === 'waiting_gift_details' && msg.text) {
    if (msg.text.toLowerCase() === 'cancel') {
      userStates.delete(chatId);
      bot.sendMessage(chatId, 'Transaction cancelled. Returning to main menu.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Buy Crypto', callback_data: 'buy_crypto' }],
            [{ text: 'Sell Crypto', callback_data: 'sell_crypto' }],
            [{ text: 'Sell Gift Cards', callback_data: 'sell_gift_cards' }],
            [{ text: 'Help', callback_data: 'help' }]
          ]
        }
      });
      return;
    }

    // Parse value and country - more flexible parsing
    const text = msg.text.trim();
    
    // Try to extract number and currency
    const numberMatch = text.match(/(\d+(?:\.\d+)?)/);
    if (!numberMatch) {
      bot.sendMessage(chatId, 'Please enter a valid amount (e.g., "50 USD", "100 EUR", "25.50 CAD"). Type "cancel" to cancel.');
      return;
    }
    
    const value = parseFloat(numberMatch[1]);
    if (!validateAmount(value.toString())) {
      bot.sendMessage(chatId, 'Please enter a valid amount (max $1,000,000). Type "cancel" to cancel.');
      return;
    }
    
    // Extract currency/country from the rest of the text
    const currencyPart = text.replace(numberMatch[0], '').trim().toUpperCase();
    if (!currencyPart) {
      bot.sendMessage(chatId, 'Please specify the currency/country (e.g., "50 USD", "100 EUR"). Type "cancel" to cancel.');
      return;
    }
    
    const country = currencyPart;

    const { giftType } = userState;
    const rate = globalSettings.giftCardRates[giftType];
    const payout = value * rate;

    userStates.set(chatId, {
      state: 'waiting_gift_upload',
      giftType,
      cardValue: value,
      country,
      payout
    });

    bot.sendMessage(
      chatId,
      `Gift Card Details:\n` +
      `Type: ${giftType}\n` +
      `Value: $${value} ${country}\n` +
      `Payout Rate: ${rate * 100}%\n` +
      `You will receive: $${payout}\n\n` +
      `Please upload an image of the gift card or enter the card code. Type "cancel" to cancel.`
    );
  }
});

// Handle gift card upload/code submission
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userState = userStates.get(chatId);

  if (userState && userState.state === 'waiting_gift_upload') {
    if (msg.text && msg.text.toLowerCase() === 'cancel') {
      userStates.delete(chatId);
      bot.sendMessage(chatId, 'Transaction cancelled. Returning to main menu.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Buy Crypto', callback_data: 'buy_crypto' }],
            [{ text: 'Sell Crypto', callback_data: 'sell_crypto' }],
            [{ text: 'Sell Gift Cards', callback_data: 'sell_gift_cards' }],
            [{ text: 'Help', callback_data: 'help' }]
          ]
        }
      });
      return;
    }

    let cardImage = null;
    let cardCode = null;

    if (msg.text && !msg.text.startsWith('/')) {
      cardCode = sanitizeText(msg.text);
    } else if (msg.photo || msg.document) {
      if (!validateFileUpload(msg)) {
        bot.sendMessage(chatId, 'Invalid file. Please upload a valid image (max 10MB) or enter card code. Type "cancel" to cancel.');
        return;
      }
      if (msg.photo && msg.photo.length > 0) {
        cardImage = msg.photo[msg.photo.length - 1].file_id;
      } else if (msg.document) {
        cardImage = msg.document.file_id;
      }
    }

    if (!cardCode && !cardImage) {
      bot.sendMessage(chatId, 'Please upload an image of the gift card or enter the card code as text. Type "cancel" to cancel.');
      return;
    }

    try {
      // Find user
      const user = await User.findOne({ telegramId: chatId.toString() });
      if (!user) {
        bot.sendMessage(chatId, 'User not found. Please restart with /start.');
        userStates.delete(chatId);
        return;
      }

      // Check for duplicate pending transactions
      const existingTransaction = await Transaction.findOne({
        user: user._id,
        type: 'sell_gift_card',
        status: 'PENDING'
      });

      if (existingTransaction) {
        bot.sendMessage(chatId, 'You already have a pending gift card sell transaction. Please wait for it to be processed or contact support.');
        userStates.delete(chatId);
        return;
      }

      // Create transaction
      const transaction = new Transaction({
        user: user._id,
        type: 'sell_gift_card',
        cryptoType: '', // Not applicable
        amount: 0, // Not applicable
        rate: globalSettings.giftCardRates[userState.giftType],
        fiatAmount: userState.payout,
        giftType: userState.giftType,
        cardValue: userState.cardValue,
        country: userState.country,
        cardImage,
        cardCode,
        status: 'PENDING'
      });

      await transaction.save();

      bot.sendMessage(
        chatId,
        `✅ Gift card sell transaction submitted successfully!\n\n` +
        `Transaction ID: ${transaction._id}\n` +
        `Status: PENDING\n\n` +
        `Your transaction is being reviewed. You will be notified once it's processed.`
      );

      // Notify admin
      const adminChatId = process.env.ADMIN_CHAT_ID;
      if (adminChatId) {
        const adminMessage = `🔔 New Gift Card Sell Transaction!\n\n` +
          `User: ${user.username} (${user.telegramId})\n` +
          `Type: ${userState.giftType} Gift Card\n` +
          `Value: $${userState.cardValue} ${userState.country}\n` +
          `Payout: $${userState.payout}\n` +
          `Transaction ID: ${transaction._id}\n` +
          `${cardCode ? `Card Code: ${cardCode}` : ''}\n` +
          `${cardImage ? `Card Image: ${cardImage}` : ''}`;

        const opts = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Approve', callback_data: `approve_${transaction._id}` }],
              [{ text: '❌ Reject', callback_data: `reject_${transaction._id}` }]
            ]
          }
        };

        bot.sendMessage(adminChatId, adminMessage, opts);
      }

      // Clear user state
      userStates.delete(chatId);

    } catch (error) {
      console.error('Error saving gift card transaction:', error);
      bot.sendMessage(chatId, 'An error occurred while processing your transaction. Please try again.');
      userStates.delete(chatId);
    }
  }
});

// Handle admin settings inputs
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const adminState = adminStates.get(chatId);

  if (adminState && msg.text) {
    if (adminState.state === 'setting_crypto_rates') {
      const rate = parseFloat(msg.text.trim());
      if (isNaN(rate) || rate <= 0) {
        bot.sendMessage(chatId, 'Please enter a valid positive number.');
        return;
      }

      adminState.rates[adminState.step.toUpperCase()] = rate;

      if (adminState.step === 'btc') {
        adminState.step = 'eth';
        bot.sendMessage(chatId, 'Enter the new ETH rate (in USD):');
      } else if (adminState.step === 'eth') {
        adminState.step = 'usdt';
        bot.sendMessage(chatId, 'Enter the new USDT rate (in USD):');
      } else if (adminState.step === 'usdt') {
        // Save rates
        try {
          await Settings.findOneAndUpdate(
            {},
            {
              cryptoRates: adminState.rates,
              updatedBy: chatId.toString(),
              updatedAt: new Date()
            },
            { upsert: true, new: true }
          );
          globalSettings.cryptoRates = adminState.rates;
          bot.sendMessage(chatId, '✅ Crypto rates updated successfully!');
          adminStates.delete(chatId);
        } catch (error) {
          console.error('Error updating crypto rates:', error);
          bot.sendMessage(chatId, 'Error updating rates.');
          adminStates.delete(chatId);
        }
      }
    } else if (adminState.state === 'setting_gift_rates') {
      const rate = parseFloat(msg.text.trim());
      if (isNaN(rate) || rate <= 0 || rate > 1) {
        bot.sendMessage(chatId, 'Please enter a valid rate between 0 and 1 (e.g., 0.85).');
        return;
      }

      const giftTypes = ['amazon', 'apple', 'google_play', 'steam'];
      const currentIndex = giftTypes.indexOf(adminState.step);
      const displayNames = { amazon: 'Amazon', apple: 'Apple', google_play: 'Google Play', steam: 'Steam' };

      adminState.rates[displayNames[adminState.step]] = rate;

      if (currentIndex < giftTypes.length - 1) {
        adminState.step = giftTypes[currentIndex + 1];
        bot.sendMessage(chatId, `Enter the new ${displayNames[adminState.step]} gift card payout rate:`);
      } else {
        // Save rates
        try {
          await Settings.findOneAndUpdate(
            {},
            {
              giftCardRates: adminState.rates,
              updatedBy: chatId.toString(),
              updatedAt: new Date()
            },
            { upsert: true, new: true }
          );
          globalSettings.giftCardRates = adminState.rates;
          bot.sendMessage(chatId, '✅ Gift card rates updated successfully!');
          adminStates.delete(chatId);
        } catch (error) {
          console.error('Error updating gift card rates:', error);
          bot.sendMessage(chatId, 'Error updating rates.');
          adminStates.delete(chatId);
        }
      }
    } else if (adminState.state === 'updating_wallets') {
      const address = msg.text.trim();
      if (!address) {
        bot.sendMessage(chatId, 'Please enter a valid wallet address.');
        return;
      }

      adminState.wallets[adminState.step.toUpperCase()] = address;

      if (adminState.step === 'btc') {
        adminState.step = 'eth';
        bot.sendMessage(chatId, 'Enter the new ETH wallet address:');
      } else if (adminState.step === 'eth') {
        adminState.step = 'usdt';
        bot.sendMessage(chatId, 'Enter the new USDT wallet address:');
      } else if (adminState.step === 'usdt') {
        // Save wallets
        try {
          await Settings.findOneAndUpdate(
            {},
            {
              wallets: adminState.wallets,
              updatedBy: chatId.toString(),
              updatedAt: new Date()
            },
            { upsert: true, new: true }
          );
          globalSettings.wallets = adminState.wallets;
          bot.sendMessage(chatId, '✅ Wallet addresses updated successfully!');
          adminStates.delete(chatId);
        } catch (error) {
          console.error('Error updating wallets:', error);
          bot.sendMessage(chatId, 'Error updating wallets.');
          adminStates.delete(chatId);
        }
      }
    }
  }
});

// Handle user payment details for approved transactions
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userState = userStates.get(chatId);

  if (userState && userState.state === 'waiting_payment_details' && msg.text) {
    try {
      const transaction = await Transaction.findById(userState.txId).populate('user');
      if (!transaction) {
        bot.sendMessage(chatId, 'Transaction not found.');
        userStates.delete(chatId);
        return;
      }

      // Update transaction
      transaction.paymentDetails = msg.text.trim();
      transaction.status = 'COMPLETED';
      await transaction.save();

      bot.sendMessage(chatId, `✅ Transaction completed!\n\nTransaction ID: ${transaction._id}\nStatus: COMPLETED\n\nYour payment is being processed. You will receive it shortly.`);

      // Notify admin
      const adminChatId = process.env.ADMIN_CHAT_ID;
      if (adminChatId) {
        bot.sendMessage(adminChatId, `✅ Transaction ${transaction._id} completed!\nPayment details: ${msg.text.trim()}`);
      }

      userStates.delete(chatId);
    } catch (error) {
      console.error('Error completing transaction:', error);
      bot.sendMessage(chatId, 'An error occurred. Please contact support.');
      userStates.delete(chatId);
    }
  }
});

// Handle admin rejection reasons
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const adminState = adminStates.get(chatId);

  if (adminState && adminState.state === 'waiting_reject_reason' && msg.text) {
    try {
      const transaction = await Transaction.findById(adminState.txId).populate('user');
      if (!transaction) {
        bot.sendMessage(chatId, 'Transaction not found.');
        adminStates.delete(chatId);
        return;
      }

      // Update transaction
      transaction.rejectReason = msg.text.trim();
      transaction.status = 'REJECTED';
      await transaction.save();

      // Notify user
      bot.sendMessage(transaction.user.telegramId, `❌ Your transaction has been rejected.\n\nTransaction ID: ${transaction._id}\nReason: ${msg.text.trim()}\n\nPlease contact support for more information.`);

      bot.sendMessage(chatId, `Transaction ${transaction._id} rejected and user notified.`);

      adminStates.delete(chatId);
    } catch (error) {
      console.error('Error rejecting transaction:', error);
      bot.sendMessage(chatId, 'An error occurred.');
      adminStates.delete(chatId);
    }
  }
});