# CardKyngTelegramBot

A Telegram bot built with Node.js using node-telegram-bot-api.

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Install and start MongoDB locally or use a cloud service like MongoDB Atlas
4. Create a `.env` file and add your configuration:
   ```
   BOT_TOKEN=your_telegram_bot_token
   MONGODB_URI=mongodb://localhost:27017/cardkyngbot
   ADMIN_CHAT_ID=your_admin_telegram_chat_id
   ADMIN_IDS=your_admin_telegram_id1,your_admin_telegram_id2
   WALLET_BTC=your_btc_wallet_address
   WALLET_ETH=your_eth_wallet_address
   WALLET_USDT=your_usdt_wallet_address
   ```
5. Run the bot: `npm start`

## Features

- /start command sends a welcome message with inline keyboard buttons
- Main menu navigation with callback handlers:
  - **Buy Crypto**: Complete flow with amount input, price calculation, and payment proof upload
  - **Sell Crypto**: Complete flow with amount input, wallet address display, and TX hash/screenshot submission
  - **Sell Gift Cards**: Complete flow with type selection, value/country input, card upload/code entry, and payout calculation
  - **Transaction History**: View past transactions with status and pagination
  - **Admin Panel** (Admin only): Settings management
  - **Help**: Information message with back navigation
- Automatic user registration in MongoDB database on /start
- Transaction management with PENDING status and admin notifications
- **Admin Approval System**: 
  - Instant transaction alerts to admins
  - Approve/Reject buttons for each transaction
  - Approval flow: Request user payment details, mark COMPLETED
  - Rejection flow: Admin provides reason, notify user, mark REJECTED
  - Restricted admin actions by Telegram ID
- **Admin Settings Panel**:
  - Set cryptocurrency exchange rates (BTC, ETH, USDT)
  - Set gift card payout rates (Amazon, Apple, Google Play, Steam)
  - Update wallet addresses for crypto deposits
  - Settings stored in MongoDB with audit trail
- Support for Amazon, Apple, Google Play, and Steam gift cards
- Clean handler-based architecture for menu navigation