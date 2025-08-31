require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

// ✅ secure way (reads from .env)
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });


let games = {}; // Store active games
let scores = {}; // Load scores

// Load scores
if (fs.existsSync("scores.json")) {
  scores = JSON.parse(fs.readFileSync("scores.json"));
}

// Save scores
function saveScores() {
  fs.writeFileSync("scores.json", JSON.stringify(scores, null, 2));
}

// Get display name
function getName(user) {
  return user.username
    ? `@${user.username}`
    : `${user.first_name || ""} ${user.last_name || ""}`.trim();
}

// Update stats
function updateStats(winner, loser, draw = false, chatId = null) {
  if (draw) {
    [winner.id, loser.id].forEach((id, idx) => {
      if (!scores[id]) scores[id] = { wins: 0, draws: 0, losses: 0, name: "", groups: {} };
      scores[id].draws++;
      scores[id].name = getName(idx === 0 ? winner : loser);
      if (chatId) {
        if (!scores[id].groups[chatId]) scores[id].groups[chatId] = { wins: 0, draws: 0, losses: 0 };
        scores[id].groups[chatId].draws++;
      }
    });
  } else {
    if (!scores[winner.id]) scores[winner.id] = { wins: 0, draws: 0, losses: 0, name: "", groups: {} };
    if (!scores[loser.id]) scores[loser.id] = { wins: 0, draws: 0, losses: 0, name: "", groups: {} };

    scores[winner.id].wins++;
    scores[loser.id].losses++;

    scores[winner.id].name = getName(winner);
    scores[loser.id].name = getName(loser);

    if (chatId) {
      if (!scores[winner.id].groups[chatId]) scores[winner.id].groups[chatId] = { wins: 0, draws: 0, losses: 0 };
      if (!scores[loser.id].groups[chatId]) scores[loser.id].groups[chatId] = { wins: 0, draws: 0, losses: 0 };

      scores[winner.id].groups[chatId].wins++;
      scores[loser.id].groups[chatId].losses++;
    }
  }
  saveScores();
}

// Create empty board
function createBoard(size) {
  return Array(size).fill(null).map(() => Array(size).fill("."));
}

// Render board
function renderBoard(game, finished = false) {
  let boardUI = game.board.map((row, r) =>
    row.map((cell, c) => ({
      text: cell,
      callback_data: JSON.stringify({ g: game.id, r, c }),
    }))
  );

  if (!finished) {
    boardUI.push([{ text: "🚪 Quit Game", callback_data: `quit_${game.id}` }]);
  } else {
    boardUI.push([{ text: "🔄 Rematch", callback_data: `rematch_${game.id}` }]);
  }

  return { inline_keyboard: boardUI };
}

// Check win with variable length
function checkWin(board, symbol, needed) {
  const size = board.length;

  // Horizontal / Vertical
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - needed; c++) {
      if (board[r].slice(c, c + needed).every((cell) => cell === symbol)) return true;
    }
  }
  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - needed; r++) {
      if (board.slice(r, r + needed).every((row) => row[c] === symbol)) return true;
    }
  }

  // Diagonal ↘
  for (let r = 0; r <= size - needed; r++) {
    for (let c = 0; c <= size - needed; c++) {
      if ([...Array(needed)].every((_, i) => board[r + i][c + i] === symbol)) return true;
    }
  }

  // Diagonal ↙
  for (let r = 0; r <= size - needed; r++) {
    for (let c = needed - 1; c < size; c++) {
      if ([...Array(needed)].every((_, i) => board[r + i][c - i] === symbol)) return true;
    }
  }

  return false;
}

// Check draw
function checkDraw(board) {
  return board.flat().every((cell) => cell !== ".");
}

// Start game
function startGame(chatId, size, starterUser, opponentUser = null) {
  const gameId = Date.now().toString();
  games[gameId] = {
    id: gameId,
    chatId,
    size,
    needed: size === 3 ? 3 : size === 6 ? 4 : 5,
    board: createBoard(size),
    players: [{ id: starterUser.id.toString(), name: getName(starterUser) }], // starter is always X
    turn: 0,
  };

  if (opponentUser) {
    games[gameId].players.push({ id: opponentUser.id.toString(), name: getName(opponentUser) });
    bot.sendMessage(
      chatId,
      `Rematch started!\n❌ Player 1: ${games[gameId].players[0].name}\n⭕ Player 2: ${games[gameId].players[1].name}\n\n❌'s turn`,
      { reply_markup: renderBoard(games[gameId]) }
    );
  } else {
    bot.sendMessage(
      chatId,
      `🎮 Tic-Tac-Toe\n\n${getName(starterUser)} is waiting for an opponent...\nPress 'Join' to start the game.`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: "Join Game", callback_data: `join_${gameId}` }]],
        },
      }
    );
  }
}

// Command to play
bot.onText(/\/play(3|6|8)/, (msg, match) => {
  const chatId = msg.chat.id;
  const size = parseInt(match[1]);
  startGame(chatId, size, msg.from);
});

// Command to show stats
bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  if (!scores[userId]) {
    scores[userId] = { wins: 0, draws: 0, losses: 0, name: getName(msg.from), groups: {} };
    saveScores();
  }

  let player = scores[userId];
  let text = `📊 *${player.name}'s Stats*\n\nWins: ${player.wins} | Losses: ${player.losses} | Draws: ${player.draws}\n\nChoose what to view:`;

  bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🌍 Global Rank", callback_data: `stats_global_${userId}` }],
        [{ text: "👥 Group Rank", callback_data: `stats_group_${chatId}_${userId}` }],
        [{ text: "🙋 Personal Stats", callback_data: `stats_personal_${userId}` }]
      ]
    }
  });
});

// ------------------ SINGLE CALLBACK HANDLER ------------------
bot.on("callback_query", (query) => {
  const data = query.data;
  const userId = query.from.id.toString();
  const chatId = query.message.chat.id;

  // ---------- GAME HANDLING ----------
  if (data.startsWith("join_")) {
    const gameId = data.split("_")[1];
    const game = games[gameId];
    if (!game) return;

    if (game.players.length < 2 && !game.players.find((p) => p.id === userId)) {
      game.players.push({ id: userId, name: getName(query.from) });

      if (game.players.length === 2) {
        bot.editMessageText(
          `Game started!\n❌ Player 1: ${game.players[0].name}\n⭕ Player 2: ${game.players[1].name}\n\n❌'s turn`,
          { chat_id: chatId, message_id: query.message.message_id, reply_markup: renderBoard(game) }
        );
      } else {
        bot.answerCallbackQuery(query.id, { text: "You joined the game!" });
      }
    } else {
      bot.answerCallbackQuery(query.id, { text: "Game already full!" });
    }
    return;
  }

  if (data.startsWith("quit_")) {
    const gameId = data.split("_")[1];
    const game = games[gameId];
    if (!game) return;
    if (!game.players.find((p) => p.id === userId)) return;

    const quitter = game.players.find((p) => p.id === userId);
    const opponent = game.players.find((p) => p.id !== userId);
    if (opponent) {
      updateStats(opponent, quitter, false, chatId);
      bot.editMessageText(`🚪 ${quitter.name} quit!\n🎉 ${opponent.name} wins by resignation!`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: renderBoard(game, true),
      });
    }
    delete games[gameId];
    return;
  }

  if (data.startsWith("rematch_")) {
    const oldGameId = data.split("_")[1];
    const oldGame = games[oldGameId];
    if (!oldGame) return;

    const [p1, p2] = oldGame.players;
    startGame(chatId, oldGame.size, { id: p1.id, first_name: p1.name }, { id: p2.id, first_name: p2.name });
    return;
  }

  // Game moves (try parse JSON)
  try {
    const move = JSON.parse(data);
    if (move.g) {
      const { g, r, c } = move;
      const game = games[g];
      if (!game) return;

      if (game.players[game.turn].id !== userId) {
        bot.answerCallbackQuery(query.id, { text: "Not your turn!" });
        return;
      }
      if (game.board[r][c] !== ".") {
        bot.answerCallbackQuery(query.id, { text: "Cell already taken!" });
        return;
      }

      const symbol = game.turn === 0 ? "❌" : "⭕";
      game.board[r][c] = symbol;

      if (checkWin(game.board, symbol, game.needed)) {
        const winner = game.players[game.turn];
        const loser = game.players[1 - game.turn];
        updateStats(winner, loser, false, chatId);

        bot.editMessageText(`🎉 Congratulations!\n${winner.name} (${symbol}) wins the game!`, {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: renderBoard(game, true),
        });
        delete games[g];
        return;
      }

      if (checkDraw(game.board)) {
        updateStats(game.players[0], game.players[1], true, chatId);
        bot.editMessageText(`🤝 It's a draw!`, {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: renderBoard(game, true),
        });
        delete games[g];
        return;
      }

      game.turn = 1 - game.turn;
      bot.editMessageText(
        `Game in progress...\n❌ Player 1: ${game.players[0].name}\n⭕ Player 2: ${game.players[1].name}\n\n${game.turn === 0 ? "❌" : "⭕"}'s turn`,
        { chat_id: chatId, message_id: query.message.message_id, reply_markup: renderBoard(game) }
      );
      return;
    }
  } catch (err) {
    // not JSON → maybe stats
  }

  // ---------- STATS HANDLING ----------
  if (data.startsWith("stats_global_")) {
    let sorted = Object.values(scores).sort((a, b) => b.wins - a.wins);
    let rank = sorted.findIndex(p => p === scores[userId]) + 1;
    let total = sorted.length;

    bot.answerCallbackQuery(query.id, { text: "Showing global rank" });
    bot.sendMessage(chatId,
      `🌍 *Global Rank*\n\n${scores[userId].name}: #${rank} out of ${total} players\nWins: ${scores[userId].wins}, Losses: ${scores[userId].losses}, Draws: ${scores[userId].draws}`,
      { parse_mode: "Markdown" });
    return;
  }

  if (data.startsWith("stats_group_")) {
    let [, groupId, uid] = data.split("_");
    let groupScores = [];

    for (let pid in scores) {
      if (scores[pid].groups[groupId]) {
        groupScores.push({
          id: pid,
          name: scores[pid].name,
          wins: scores[pid].groups[groupId].wins,
        });
      }
    }

    groupScores.sort((a, b) => b.wins - a.wins);
    let rank = groupScores.findIndex(p => p.id == uid) + 1;
    let total = groupScores.length;

    let gs = scores[uid].groups[groupId];
    bot.answerCallbackQuery(query.id, { text: "Showing group rank" });
    bot.sendMessage(chatId,
      `👥 *Group Rank*\n\n${scores[uid].name}: #${rank} out of ${total} players\nWins: ${gs.wins}, Losses: ${gs.losses}, Draws: ${gs.draws}`,
      { parse_mode: "Markdown" });
    return;
  }

  if (data.startsWith("stats_personal_")) {
    let uid = data.split("_")[2];
    let p = scores[uid];
    bot.answerCallbackQuery(query.id, { text: "Showing personal stats" });
    bot.sendMessage(chatId,
      `🙋 *Personal Stats*\n\n${p.name}\nWins: ${p.wins}\nLosses: ${p.losses}\nDraws: ${p.draws}`,
      { parse_mode: "Markdown" });
    return;
  }
});
// Intro message for /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const intro = `
👋 Hello *${msg.from.first_name || "Player"}*!

Welcome to 🎮 *Tic Tac Toe Bot*.

Here’s what I can do:

⚡ *Play Tic Tac Toe* with your friends right here in Telegram  
- /play3 → Classic 3x3 (3 in a row to win)  
- /play6 → 6x6 board (4 in a row to win)  
- /play8 → 8x8 board (5 in a row to win)  

📊 *Track Scores*  
- /stats → See your Wins, Losses & Draws  
- Choose Global, Group or Personal ranking  

🏆 *Features*  
- Rematch button after every game  
- Quit anytime with 🚪 Quit button  
- Smart win detection depending on board size  

So… ready to challenge your friends? 😏  
Type *any play command* to begin!
  `;
  bot.sendMessage(chatId, intro, { parse_mode: "Markdown" });
});
