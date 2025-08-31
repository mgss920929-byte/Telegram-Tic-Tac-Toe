require("dotenv").config();  // load .env variables
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

// ✅ secure way (reads from .env)
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Scores file path
const SCORES_FILE = "scores.json";

// ---------------- HELPER FUNCTIONS ----------------
function loadScores() {
  if (!fs.existsSync(SCORES_FILE)) return { players: {} };
  return JSON.parse(fs.readFileSync(SCORES_FILE));
}

function saveScores(data) {
  fs.writeFileSync(SCORES_FILE, JSON.stringify(data, null, 2));
}

// Ensure player exists
function ensurePlayer(user, groupId = null) {
  let scores = loadScores();
  if (!scores.players[user.id]) {
    scores.players[user.id] = {
      id: user.id,
      name: user.first_name,
      username: user.username || null,
      wins: 0,
      losses: 0,
      draws: 0,
      groups: {}
    };
  }
  if (groupId && !scores.players[user.id].groups[groupId]) {
    scores.players[user.id].groups[groupId] = { wins: 0, losses: 0, draws: 0 };
  }
  saveScores(scores);
}

// ---------------- UPDATE STATS AFTER GAME ----------------
function updateStats(winner, loser, groupId, isDraw = false) {
  let scores = loadScores();

  [winner, loser].forEach(u => {
    if (!scores.players[u.id]) {
      scores.players[u.id] = {
        id: u.id,
        name: u.name,
        username: u.username || null,
        wins: 0,
        losses: 0,
        draws: 0,
        groups: {}
      };
    }
    if (!scores.players[u.id].groups[groupId]) {
      scores.players[u.id].groups[groupId] = { wins: 0, losses: 0, draws: 0 };
    }
  });

  if (isDraw) {
    scores.players[winner.id].draws++;
    scores.players[loser.id].draws++;
    scores.players[winner.id].groups[groupId].draws++;
    scores.players[loser.id].groups[groupId].draws++;
  } else {
    scores.players[winner.id].wins++;
    scores.players[loser.id].losses++;
    scores.players[winner.id].groups[groupId].wins++;
    scores.players[loser.id].groups[groupId].losses++;
  }

  saveScores(scores);
}

// ---------------- COMMAND: /stats ----------------
bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  ensurePlayer(msg.from, chatId);

  let scores = loadScores();
  let player = scores.players[userId];

  let text = `📊 *${player.name}'s Stats*\n(@${player.username || "no_username"})\n\nWins: ${player.wins} | Losses: ${player.losses} | Draws: ${player.draws}\n\nChoose what to view:`;

  bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🌍 Global Rank", callback_data: `global_${userId}` }],
        [{ text: "👥 Group Rank", callback_data: `group_${chatId}_${userId}` }],
        [{ text: "🙋 Personal Stats", callback_data: `personal_${userId}` }]
      ]
    }
  });
});

// ---------------- CALLBACK HANDLER ----------------
bot.on("callback_query", (query) => {
  const data = query.data;
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  let scores = loadScores();
  let players = scores.players;

  if (data.startsWith("global_")) {
    let sorted = Object.values(players).sort((a, b) => b.wins - a.wins);
    let rank = sorted.findIndex(p => p.id == userId) + 1;
    let total = sorted.length;

    bot.answerCallbackQuery(query.id, { text: "Showing global rank" });
    bot.sendMessage(
      chatId,
      `🌍 *Global Rank*\n\n${players[userId].name} (@${players[userId].username || "no_username"}): #${rank} out of ${total} players\nWins: ${players[userId].wins}, Losses: ${players[userId].losses}, Draws: ${players[userId].draws}`,
      { parse_mode: "Markdown" }
    );

  } else if (data.startsWith("group_")) {
    let [, groupId, uid] = data.split("_");
    let groupScores = [];

    for (let pid in players) {
      if (players[pid].groups[groupId]) {
        groupScores.push({
          id: pid,
          name: players[pid].name,
          username: players[pid].username,
          wins: players[pid].groups[groupId].wins
        });
      }
    }

    groupScores.sort((a, b) => b.wins - a.wins);
    let rank = groupScores.findIndex(p => p.id == uid) + 1;
    let total = groupScores.length;

    let gs = players[uid].groups[groupId];
    bot.answerCallbackQuery(query.id, { text: "Showing group rank" });
    bot.sendMessage(
      chatId,
      `👥 *Group Rank*\n\n${players[uid].name} (@${players[uid].username || "no_username"}): #${rank} out of ${total} players\nWins: ${gs.wins}, Losses: ${gs.losses}, Draws: ${gs.draws}`,
      { parse_mode: "Markdown" }
    );

  } else if (data.startsWith("personal_")) {
    let uid = data.split("_")[1];
    let p = players[uid];
    bot.answerCallbackQuery(query.id, { text: "Showing personal stats" });
    bot.sendMessage(
      chatId,
      `🙋 *Personal Stats*\n\n${p.name} (@${p.username || "no_username"})\nWins: ${p.wins}\nLosses: ${p.losses}\nDraws: ${p.draws}`,
      { parse_mode: "Markdown" }
    );
  }
});

// ---------------- EXPORTS ----------------
module.exports = { updateStats };
