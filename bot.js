// bot.js – Telegram bot calculating maximum CPL for Rentino
// Requires: node-telegram-bot-api and dotenv
// Make sure package.json contains "type": "module"
// Usage: BOT_TOKEN=xxx node bot.js

import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';

dotenv.config();

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('❌  Set BOT_TOKEN in .env or env vars');
  process.exit(1);
}

// Long-polling bot
const bot = new TelegramBot(token, { polling: true });
console.log('🤖 Bot started with polling…');

// ────────────────────────────────────────────────────────────
// CONSTANTS
// ────────────────────────────────────────────────────────────

// Main persistent reply keyboard (bottom menu)
const MAIN_MENU = {
  reply_markup: {
    keyboard: [
      [{ text: 'Калькулятор арбитражника' }],
      [{ text: 'Наш тг-канал' }],
      [{ text: 'Связаться с менеджером/задать вопрос' }],
      [{ text: 'Реклама в Telegram Ads' }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
  parse_mode: 'Markdown',
};

// Destination links
const MANAGER_LINK = 'https://t.me/tikhomirovkir';
const CHANNEL_LINK = 'https://t.me/shnurok_shipping';

const managerMarkup = {
  reply_markup: {
    inline_keyboard: [[{ text: 'Открыть чат', url: MANAGER_LINK }]],
  },
};

const channelMarkup = {
  reply_markup: {
    inline_keyboard: [[{ text: 'Открыть канал', url: CHANNEL_LINK }]],
  },
};

// Per-chat finite-state machines for /lead wizard
const sessions = new Map();

// ────────────────────────────────────────────────────────────
// Utility: Calculate CPL
// ────────────────────────────────────────────────────────────

/**
 * Calculate CPL.
 * @param {Object} p
 * @param {number} p.payout  – payout per approved lead
 * @param {number} p.approve – approval rate, %
 * @param {number} [p.trash] – trash rate, %
 * @param {number} [p.roi]   – desired ROI, %
 */
function calcCPL({ payout, approve, trash = 0, roi = 0 }) {
  const A = approve / 100;
  const T = trash / 100;
  const R = roi / 100;

  const breakeven = (payout * A) / (1 + T);
  const leadPrice = breakeven / (1 + R);

  return {
    breakeven: +breakeven.toFixed(4),
    leadPrice: +leadPrice.toFixed(4),
  };
}

// ────────────────────────────────────────────────────────────
// /start – greeting + main menu
// ────────────────────────────────────────────────────────────

bot.onText(/\/start/, (msg) => {
  const greeting =
    'Привет! Это бот *Rentino* — сервиса пополнения рекламных кабинетов.\n' +
    'Выберите из списка меню, что вы ищете.';

  bot.sendMessage(msg.chat.id, greeting, MAIN_MENU);
});

// ────────────────────────────────────────────────────────────
// Quick one-line mode: /calc
// ────────────────────────────────────────────────────────────

bot.onText(/\/calc (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const args = match[1].trim().split(/\s+/).map(Number);
  if (args.length < 3) {
    return bot.sendMessage(chatId, 'Нужно минимум 3 числа: выплата, аппрув, трэш. ROI опционально.');
  }
  const [payout, approve, trash, roi = 0] = args;
  if ([payout, approve, trash, roi].some((n) => Number.isNaN(n))) {
    return bot.sendMessage(chatId, 'Все аргументы должны быть числами.');
  }

  const { breakeven, leadPrice } = calcCPL({ payout, approve, trash, roi });
  bot.sendMessage(
    chatId,
    `CPL при ROI 0: *$${breakeven}*\n` + `CPL при ROI ${roi}%: *$${leadPrice}*`,
    { parse_mode: 'Markdown' }
  );
});

// ────────────────────────────────────────────────────────────
// Interactive wizard: /lead
// ────────────────────────────────────────────────────────────

bot.onText(/\/lead/, (msg) => {
  sessions.set(msg.chat.id, { step: 'payout', data: {} });
  bot.sendMessage(msg.chat.id, 'Введите *выплату* за подтверждённый лид (число):', {
    parse_mode: 'Markdown',
  });
});

// ────────────────────────────────────────────────────────────
// Generic message handler – handles menu buttons & wizard steps
// ────────────────────────────────────────────────────────────

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  if (!msg.text || msg.text.startsWith('/')) return; // ignore commands (handled above)

  // 1. Handle main-menu buttons ------------------------------------------------
  switch (msg.text) {
    case 'Калькулятор арбитражника':
      bot.sendMessage(
        chatId,
        '*Быстрый режим* — одна команда:\n' +
          '`/calc <выплата> <аппрув%> <трэш%> <ROI%>`\n' +
          'Пример: `/calc 20 35 30 50`\n\n' +
          '*Пошаговый режим* — введите `/lead` и отвечайте на вопросы.',
        { parse_mode: 'Markdown' }
      );
      return; // nothing more to do

    case 'Наш тг-канал':
      bot.sendMessage(chatId, 'Переходите в наш Telegram-канал по кнопке ниже.', channelMarkup);
      return;

    case 'Связаться с менеджером/задать вопрос':
    case 'Реклама в Telegram Ads':
      bot.sendMessage(chatId, 'Откройте чат с менеджером по кнопке ниже.', managerMarkup);
      return; // handled

    default:
      // continue below — maybe this is a wizard answer
  }

  // 2. Handle /lead wizard steps ---------------------------------------------
  const session = sessions.get(chatId);
  if (!session) return; // not in wizard

  const val = Number(msg.text.replace(',', '.'));
  if (Number.isNaN(val)) {
    return bot.sendMessage(chatId, 'Пожалуйста, отправьте число.');
  }

  switch (session.step) {
    case 'payout':
      session.data.payout = val;
      session.step = 'approve';
      bot.sendMessage(chatId, 'Процент *аппрува* (без %):', { parse_mode: 'Markdown' });
      break;

    case 'approve':
      session.data.approve = val;
      session.step = 'trash';
      bot.sendMessage(chatId, 'Процент *трэша* (без %; если нет, 0):', { parse_mode: 'Markdown' });
      break;

    case 'trash':
      session.data.trash = val;
      session.step = 'roi';
      bot.sendMessage(chatId, 'Желаемый *ROI* (без %; 0 для нуля):', { parse_mode: 'Markdown' });
      break;

    case 'roi':
      session.data.roi = val;
      const { breakeven, leadPrice } = calcCPL(session.data);
      bot.sendMessage(
        chatId,
        `✅ Готово!\nCPL при ROI 0: *$${breakeven}*\n` +
          `CPL при ROI ${val}%: *$${leadPrice}*`,
        { parse_mode: 'Markdown' }
      );
      sessions.delete(chatId);
      break;

    default:
      sessions.delete(chatId);
      bot.sendMessage(chatId, 'Ошибка состояния. Начните заново с /lead');
  }
});

// ────────────────────────────────────────────────────────────
// Error handler
// ────────────────────────────────────────────────────────────

bot.on('polling_error', (err) => console.error('Polling error:', err));