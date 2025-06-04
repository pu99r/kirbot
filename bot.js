// bot.js – Telegram bot calculating maximum CPL
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

// 🔥 Promotional block sent 10 s after /start
const AD_TEXT = 'Получи агентские рекламные кабинеты Meta, Bigo, Kwai, TikTok, Snapchat за 30 минут. Комисия от 6 %! Безлимитные бюджеты и моментальные запуски!';

const AD_MARKUP = {
  parse_mode: 'Markdown',
  disable_web_page_preview: false,
  reply_markup: {
    inline_keyboard: [
      [
        {
          text: '➡️ Перейти',
          url: 'https://t.me/tikhomirovkir',
        },
      ],
    ],
  },
};

// Per-chat finite-state machines for /lead wizard
const sessions = new Map();

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

// /start – greeting + help
bot.onText(/\/start/, (msg) => {
  const text =
    `Привет, ${msg.from.first_name || 'друг'}!\n\n` +
    'Я помогу рассчитать предельную стоимость лида.\n\n' +
    '*Быстрый режим* – одна команда:\n' +
    '`/calc <выплата> <аппрув%> <трэш%> <ROI%>`\n' +
    'Пример: `/calc 20 35 30 50`\n\n' +
    '*Пошаговый режим* – введите `/lead` и отвечайте на вопросы.';

  bot
    .sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' })
    .then(() => {
      // send promo after 10 000 ms
      setTimeout(() => {
        bot.sendMessage(msg.chat.id, AD_TEXT, AD_MARKUP);
      }, 10_000);
    });
});

// /calc – one-line mode
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

// /lead – interactive wizard
bot.onText(/\/lead/, (msg) => {
  sessions.set(msg.chat.id, { step: 'payout', data: {} });
  bot.sendMessage(msg.chat.id, 'Введите *выплату* за подтверждённый лид (число):', {
    parse_mode: 'Markdown',
  });
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  if (!msg.text || msg.text.startsWith('/')) return;

  const s = sessions.get(chatId);
  if (!s) return; // not in wizard

  const val = Number(msg.text.replace(',', '.'));
  if (Number.isNaN(val)) {
    return bot.sendMessage(chatId, 'Пожалуйста, отправьте число.');
  }

  switch (s.step) {
    case 'payout':
      s.data.payout = val;
      s.step = 'approve';
      bot.sendMessage(chatId, 'Процент *аппрува* (без %):', { parse_mode: 'Markdown' });
      break;
    case 'approve':
      s.data.approve = val;
      s.step = 'trash';
      bot.sendMessage(chatId, 'Процент *трэша* (без %; если нет, 0):', { parse_mode: 'Markdown' });
      break;
    case 'trash':
      s.data.trash = val;
      s.step = 'roi';
      bot.sendMessage(chatId, 'Желаемый *ROI* (без %; 0 для нуля):', { parse_mode: 'Markdown' });
      break;
    case 'roi':
      s.data.roi = val;
      const { breakeven, leadPrice } = calcCPL(s.data);
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

bot.on('polling_error', (err) => console.error('Polling error:', err));