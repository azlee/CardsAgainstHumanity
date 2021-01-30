const express = require('express');
const app = express();
app.use(express.static('./public'));
var http = require('http').Server(app);
var port = 61001;

var io = require('socket.io')(http);
const fs = require('fs');

/****************************************************************************
* 
* Utility functions
* 
****************************************************************************/

/**
* Randomly shuffle an array
* https://stackoverflow.com/a/2450976/1293256
* @param  {Array} array The array to shuffle
* @return {String}      The first item in the shuffled array
*/
function shuffle(array) {

   var currentIndex = array.length;
   var temporaryValue, randomIndex;

   // While there remain elements to shuffle...
   while (0 !== currentIndex) {
       // Pick a remaining element...
       randomIndex = Math.floor(Math.random() * currentIndex);
       currentIndex -= 1;

       // And swap it with the current element.
       temporaryValue = array[currentIndex];
       array[currentIndex] = array[randomIndex];
       array[randomIndex] = temporaryValue;
   }
   return array;
};

/**
 * Generate a random room code of 4 uppercase letters
 */
function generateRoomCode() {
    var len = 4;
    var arr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var code = '';
    for (var i = len; i > 0; i--) {
        code += arr[Math.floor(Math.random() * arr.length)];
    }
    if (GAME_LOBBIES.get(code)) {
        return generateRoomCode();
    }
    return code;
}

/**
 * Get the number of occurences of element in arr
 * @param {*} element 
 * @param {*}} arr 
 */
function numElementInArr(element, arr) {
    var occurences = 0;
    for (var elem of arr) {
        if (element === elem) {
            occurences++;
        }
    }
    return occurences;
}

/****************************************************************************
 * 
 * Enumerations
 * 
 ****************************************************************************/

const PlayerState = {
    NOT_PLAYED_CARD: 'NOT_PLAYED_CARD',
    PLAYED_CARD: 'PLAYED_CARD',
    DREW_NEW_CARD: 'DREW_NEW_CARD'
}
const PlayerRole = {
    JUDGE: "JUDGE",
    NON_JUDGE: "NON_JUDGE"
}

const GameStatus = {
    WAITING_FOR_ANSWERS: "WAITING FOR ANSWERS",
    ALL_CARDS_PLAYED: "ALL CARDS PLAYED",
    ALL_CARDS_REVEALED: "ALL CARDS REVEALED",
    WINNER_CHOSEN: "WINNER_CHOSEN"
}

const MoveType = {
    // only judge can choose winner
    CHOOSE_WINNER_CARD: "CHOOSE_WINNER_CARD",
    // only current judge can draw new question card
    DRAW_NEW_QUESTION: "DRAW_NEW_QUESTION",
    // only non judges can do these moves
    PLAY_ANSWER_CARD: "PLAY_ANSWER_CARD",
    UNDO_PLAY_ANSWER_CARD: "UNDO_PLAY_ANSWER_CARD",
    DRAW_NEW_ANSWER: "DRAW_NEW_ANSWER"
}

/* Map of the game lobbies - key is room id/code and value is the lobby */
var GAME_LOBBIES = new Map();
/* Map of all connected sockets. The key is socket id and value is an object with playerId and gameRoomCode */
var SOCKETS_MAP = new Map(); /* ex. { socketId1: { playerId: 0, gameRoomCode: BOLT } }

/* Max number players per game */
const MAX_NUMBER_PLAYERS = 20;

/* Number of cards per player */
const NUMBER_CARDS_PER_PLAYER = 10;

var INVALID_ROOM_CODE_ERROR = "Invalid room code";
var MAX_PLAYERS_ERROR = "Too many players in this room";
var ROUND_IN_PROGRESS_ERROR = "Round is in progress - try joining later";
var PLAYER_WITH_SAME_NAME_ERROR = "Player with name '%s' is already in game. Choose different name";

/****************************************************************************
 * 
 * All game state helpers
 * 
 ****************************************************************************/

/**
 * Return an array of answer cards
 * @param {num} numCards 
 * @return {[str]} answer cards 
 */
function getCardHand(numCards, gameRoom) {
    var cards = [];
    for (var i = 0; i < numCards; i++) {
        var card = getAnswerCard(gameRoom);
        cards.push(card);
    }
    return cards;
}

 function readFile(path) {
	 return fs.readFileSync(__dirname + "/" + path);
 }

 /**
 * Initialize game state
 * @param {str} gameId
 * @param {str} version - PG vs M
 */
 function initializeGameState(gameId, version) {
    var GameState = {
        // all unused answers
        answers: shuffle(readFile(version === "PG" ? 'public/data/clean-answers.txt' : 'public/data/answers.txt').toString().split("\n")),
        // answer cards in play (in center)
        answerCards: [],
        discardAnswers: [],
        discardQuestions: [],
        judge: 0, // judge player index
        gameId: gameId,
        gameStatus: 'WAITING FOR ANSWERS',
        // total number of players
        numCardsPerPlayer: NUMBER_CARDS_PER_PLAYER,
        players: new Map(), // pseudo map of Players
        questions: shuffle(readFile(version === "PG" ? 'public/data/clean-questions.txt' : 'public/data/questions.txt').toString().split("\n")),
        roundNum: 1,
        winnerCard: null,
    };
    return GameState;
}

/**
 * Create a player object
 * @param {str} id - id of player
 * @param {str} name - name of player
 * @param {str} gameRoom - id of game room
 * @return {Player} - new player object
 */
function initializePlayer(id, name, gameRoom) {
    var GameState = getGameLobby(gameRoom).gameState;
    return {
        cardsInHand: getCardHand(GameState.numCardsPerPlayer, gameRoom),
        id: id,
        name: name,
        role: id === GameState.judge ? PlayerRole.JUDGE : PlayerRole.NON_JUDGE,
        score: 0,
        state: PlayerState.NOT_PLAYED_CARD,
        // The player's winning card combos - combo includes question & answer
        winningAnswers: [],
        winningQuestions: [],
    }
}

/**
 * Create a game room with the game room id
 * @param {str} gameRoomId 
 * @param {str} version - PG or M
 */
function createGameRoom(gameRoomId, version) {
    var gameRoom = {
        gameId: gameRoomId,
        gameState: initializeGameState(gameRoomId, version),
        playerNames: [],
        maxPlayers: MAX_NUMBER_PLAYERS,
    }
    return gameRoom;
}

/**
 * Check if all the players in the game room already played & drew a card (not including judge)
 */
function didEveryoneDraw(gameRoomId) {
    var GameState = getGameLobby(gameRoomId).gameState;
    for (let [_, player] of GameState.players) {
        if (player.role != PlayerRole.JUDGE && player.state != PlayerState.PLAYED_CARD) {
            return false;
        }
    }
    return true;
}

/**
 * Add a socketId, playerId, game room code key value pair to game lobby
 * We need this so we can remove players from their game room when socket disconnects
 * @param {str} socketId 
 * @param {str} gameRoomId 
 * @param {str} playerId 
 */
function addPlayerSocketIdToGameLobby(socketId, gameRoomId, playerId) {
    SOCKETS_MAP.set(socketId, { playerId: playerId, gameRoomId: gameRoomId });
}

/****************************************************************************
 * 
 * All methods that access the game state.
 * 
 ****************************************************************************/

 /**
  * Get the game room
  * @param {str} id 
  */
function getGameLobby(id) {
    return GAME_LOBBIES.get(id);
}

 /**
  * Get the game room state
  * @param {str} gameRoomId 
  */
function getGameState(gameRoomId) {
    var gameRoom = getGameLobby(gameRoomId);
    var gameState = gameRoom ? gameRoom.gameState : null;
    return gameState;
}

/**
 * Return the Player who played the winner card
 * @param {str} gameRoom
 * @param {str} winnerCard 
 * @return Player who played the winnerCard
 */
function getWinnerPlayer(gameRoom, winnerCard) {
    var GameState = getGameState(gameRoom);
    for (let [_, player] of GameState.players) {
        if (player.finalCard === winnerCard) {
            return player;
        }
    }
    return null;
}

/**
 * Get a new judge for the game room
 * @param {str} gameRoom 
 */
function getNewJudge(gameRoom) {
    var GameState = getGameState(gameRoom);
    var playerIds = Array.from(GameState.players.keys());
    var judgeIndex = playerIds.indexOf(GameState.judge);
    var newJudgeId = (judgeIndex === playerIds.length - 1) ? 0 : judgeIndex + 1;
    return playerIds[newJudgeId];
}

/**
 * Check if all the players in the room drew a card (not including judge)
 * @param {str} gameRoom - game room code
 */
function didEveryoneDraw(gameRoom) {
    var GameState = GAME_LOBBIES.get(gameRoom).gameState;
    for (let [_, player] of GameState.players) {
        if (player.role != PlayerRole.JUDGE && player.state != PlayerState.DREW_NEW_CARD) {
            return false;
        }
    }
    return true;
}

/****************************************************************************
 * 
 * All methods that update the game state.
 * Includes add/update cards, update game status, winner, score, etc.
 * 
 ****************************************************************************/

/**
 * Get an answer card from top
  * @param {str} gameRoom
 * @return text for Cards against humanity answer
 */
function getAnswerCard(gameRoom) {
    var GameState = getGameState(gameRoom);
    if (GameState.answers.length === 0) {
        reuseDiscardAnswers(gameRoom);
    };
    return GameState.answers.pop();
}

/**
 * Get a question card from top
  * @param {str} gameRoom
 * @return text for Cards against humanity question
 */
function getQuestionCard(gameRoom) {
    var GameState = getGameState(gameRoom);
    if (GameState.questions.length === 0) {
        reuseDiscardQuestions(gameRoom);
    };
    return GameState.questions.pop();
}

 /**
  * Add a card to current player's hand
  * @param {str} gameRoom
  * @param {str} playerId
  * @param {str} card - text of card to add
  */
function addCardToHand(gameRoom, playerId, card) {
    var GameState = getGameState(gameRoom);
    var index = GameState.players.get(playerId).cardsInHand.indexOf(null);
    GameState.players.get(playerId).cardsInHand[index] = card;
}

 /**
  * Remove a card from current player's hand
  * @param {str} gameRoom
  * @param {str} playerId
  * @param {str} card - text of card to remove
  */
function removeCardFromHand(gameRoom, playerId, card) {
    var GameState = getGameState(gameRoom);
    var index = GameState.players.get(playerId).cardsInHand.indexOf(card);
    GameState.players.get(playerId).cardsInHand[index] = null;
}

/**
 * Add answer card to center
 * @param {str} gameRoom
 * @param {str} answer - text of card to add
 */
function addCardToCenter(gameRoom, answer) {
    var GameState = getGameState(gameRoom);
    GameState.answerCards.push(answer);
}

/**
 * Remove answer card from center
 * @param {str} gameRoom
 * @param {str} answer - text of card to remove
 */
function removeCardFromCenter(gameRoom, answer) {
    var GameState = getGameState(gameRoom);
    var index = GameState.answerCards.indexOf(answer);
    GameState.answerCards.splice(index, 1);
}

/**
 * Shuffle the answer cards in the center
 * @param {str} gameRoom - game room code
 */
function shuffleAnswers(gameRoom) {
    var GameState = getGameState(gameRoom);
    GameState.answerCards = shuffle(GameState.answerCards);
}

/**
 * Use shuffled discard answer cards as answers
 * We use this when we run out of answer cards in the pickup pile
 * @param {str} gameRoom - game room code
 */
function reuseDiscardAnswers(gameRoom) {
    var GameState = getGameState(gameRoom);
    GameState.answerCards = shuffle(GameState.discardAnswers);
    GameState.discardAnswers = [];
}

/**
 * Use shuffled discard questions cards as question
 * We use this when we run out of question cards in the pickup pile
 * @param {str} gameRoom - game room code
 */
function reuseDiscardQuestions(gameRoom) {
    var GameState = getGameState(gameRoom);
    GameState.questions = shuffle(GameState.discardQuestions);
    GameState.discardQuestions = [];
}

/**
 * Choose a winner card for the game room
 * @param {str} gameRoom - game room code
 * @param {str} card - winning card text
 */
function chooseWinner(gameRoom, card) {
    var GameState = getGameState(gameRoom);
    GameState.winnerCard = card;
    GameState.gameStatus = GameStatus.WINNER_CHOSEN;
    // increment winner's score
    var winnerPlayer = getWinnerPlayer(gameRoom, card);
    GameState.players.get(winnerPlayer.id).score =  GameState.players.get(winnerPlayer.id).score + 1;
    // add the winning combo to the player's winning combos
    GameState.players.get(winnerPlayer.id).winningAnswers.push(card);
    GameState.players.get(winnerPlayer.id).winningQuestions.push(GameState.currentQuestion);
}

/**
 * Push player to game room
 * @param {str} gameRoomId 
 * @param {str} player 
 */
function pushPlayerToGameRoom(gameRoomId, player) {
    GAME_LOBBIES.get(gameRoomId).gameState.players.set(player.id, player);
}

/**
 * Add player to game room
 * @param {str} name 
 * @param {str} gameRoomId 
 */
function addPlayerGameLobby(name, gameRoomId) {
    // Add player to game room lobby
    var gameRoom = GAME_LOBBIES.get(gameRoomId);
    if (!gameRoom) {
        throw INVALID_ROOM_CODE_ERROR;
    }
    // to generate player id get the last player in the game and increment by one
    var playerIds = Array.from(gameRoom.gameState.players.keys());
    var lastPlayer = gameRoom.gameState.players.get(playerIds[playerIds.length - 1]);
    var lastPlayerId = lastPlayer.id;
    var playerId = lastPlayerId + 1;
    var numSameName = numElementInArr(name, gameRoom.playerNames);
    // if player has same name then append number on it
    if (numSameName > 0) {
        throw PLAYER_WITH_SAME_NAME_ERROR.replace("%s", name);
    }
    var player = initializePlayer(playerId, name, gameRoomId);
    if (playerIds.length >= MAX_NUMBER_PLAYERS) {
        throw MAX_PLAYERS_ERROR;
    }
    if (didEveryoneDraw(gameRoomId) && gameRoom.playerNames.length > 1) {
        // don't let player join game when all the cards in middle have already been revealed
        throw ROUND_IN_PROGRESS_ERROR;
    }
    pushPlayerToGameRoom(gameRoomId, player);
    gameRoom.playerNames.push(player.name);
    sendStateUpdate(gameRoomId);
    return playerId;
}

/**
 * Create a new round for game room and update the game state accordingly
 * @param {str} gameRoom - game room code
 */
function newRound(gameRoom) {
    var GameState = getGameState(gameRoom);
    // new round ONLY if winner was choosen
    if (GameState.gameStatus !== GameStatus.WINNER_CHOSEN) { return; }
    GameState.answerCards = [];
    // discard the cards used
    GameState.answerCards.forEach(answer => {
        GameState.discardAnswers.push(answer);
    });
    GameState.discardQuestions.push(GameState.currentQuestion);
    GameState.currentQuestion = getQuestionCard(gameRoom);
    GameState.answerCards = [];
    GameState.gameStatus = GameStatus.WAITING_FOR_ANSWERS;
    GameState.winnerCard = null;
    GameState.roundNum = GameState.roundNum + 1;
    // set new judge
    GameState.players.get(GameState.judge).role = PlayerRole.NON_JUDGE;
    var newJudge = getNewJudge(gameRoom);
    GameState.judge = newJudge;
    GameState.players.get(newJudge).role = PlayerRole.JUDGE;
    var playerIds = Array.from(GameState.players.keys());
    for (var i = 0; i < playerIds.length; i++) {
        var playerId = playerIds[i];
        GameState.players.get(playerId).state = PlayerState.NOT_PLAYED_CARD;
        GameState.players.get(playerId).finalCard = null;
    }
}

/**
 * Apply game room by updating the game state for the room
 * @param {str} gameRoom 
 * @param {MoveType} move 
 * @param {str} answer 
 * @param {str} playerId 
 */
function applyMove(gameRoom, move, answer, playerId) {
    var GameState = getGameState(gameRoom);
    if (!GameState) {
        sendStateUpdate(gameRoom);
    }
    if (move === MoveType.PLAY_ANSWER_CARD) {
        // player is playing an answer card
        GameState.players.get(playerId).finalCard = answer;
        removeCardFromHand(gameRoom, playerId, answer);
        addCardToCenter(gameRoom, answer);
        // draw new card for player
        addCardToHand(gameRoom, playerId, getAnswerCard(gameRoom));
        GameState.players.get(playerId).state = PlayerState.PLAYED_CARD;
        // if all players drew card then shuffle
        if (didEveryoneDraw(gameRoom)) {
            shuffleAnswers(gameRoom);
        }
        GameState.players.get(playerId).state = PlayerState.PLAYED_CARD;
    } else if (move === MoveType.CHOOSE_WINNER_CARD) {
        chooseWinner(gameRoom, answer);
    } else if (move === MoveType.DRAW_NEW_QUESTION ) {
        newRound(gameRoom);
    }
    sendStateUpdate(gameRoom);
}

/**
 * Initialize a new game with one player that has the socket id
 * @param {str} name first player joining new game
 * @param {str} version PG vs M
 * @param {str} socketId the socketId of first player connection
 */
function initNewGame(name, version, socketId) {
   var gameRoomCode = generateRoomCode();
   var gameRoom = createGameRoom(gameRoomCode, version);
   GAME_LOBBIES.set(gameRoomCode, gameRoom);
   var GameState = GAME_LOBBIES.get(gameRoomCode).gameState;
   GameState.currentQuestion = getQuestionCard(gameRoomCode);
   // Add player to game room lobby - first player in game has id 0
   var playerId = 0;
   // add socket id, player to game lobby
   addPlayerSocketIdToGameLobby(socketId, gameRoomCode, playerId);
   var player = initializePlayer(playerId, name, gameRoomCode);
   pushPlayerToGameRoom(gameRoomCode, player);
   GAME_LOBBIES.get(gameRoomCode).playerNames.push(player.name);
   return gameRoomCode;
}

/**
 * Remove player from game
 * @param {str} gameRoomId 
 * @param {str} playerId 
 */
function removePlayerFromGame(gameRoomId, playerId) {
    var gameRoom = GAME_LOBBIES.get(gameRoomId).gameState;
    if (!gameRoom || gameRoom.players.size === 0) { return; }
    var player = gameRoom.players.get(playerId);
    if (!player) { return; }
    // transfer the player's cards to discard piles
    gameRoom.discardAnswers = gameRoom.discardAnswers.concat(player.cardsInHand);
    if (player.finalCard) {
        // remove from center
        removeCardFromCenter(gameRoomId, player.finalCard);
        gameRoom.discardAnswers.push(player.finalCard);
    }
    if (player.role === PlayerRole.JUDGE) { // assign new judge
        gameRoom.judge = getNewJudge(gameRoomId);
        gameRoom.players.get(gameRoom.judge).role = PlayerRole.JUDGE;
    }

    // delete player from game
    gameRoom.players.delete(playerId);
    // remove player from names
    var playerNames = GAME_LOBBIES.get(gameRoomId).playerNames;
    playerNames.splice(playerNames.indexOf(player.name), 1);

    // if no more players then delete the game room
    if (gameRoom.players.size === 0) {
        GAME_LOBBIES.delete(gameRoomId);
    }
}

/****************************************************************************
 * 
 * Server Socket connection
 * 
 ****************************************************************************/

io.on('connection', function(socket) {
    console.log('\n')
    console.log('new connection ' + socket.id);

    socket.on('disconnect', function() {
        // on disconnect, remove the player from the game
        // if the player is the last player then 
        var gamePlayer = SOCKETS_MAP.get(socket.id);
        // remove the player from game
        if (gamePlayer) {
            removePlayerFromGame(gamePlayer.gameRoomId, gamePlayer.playerId);
            SOCKETS_MAP.delete(socket.id);
            sendStateUpdate(gamePlayer.gameRoomId)
        }
    });
    socket.on('createGame', function(msg) {
        try {
            var gameRoomId = initNewGame(msg.name, msg.version, socket.id);
            // send notification of game room code to player
            io.to(socket.id).emit('createGameSuccess', gameRoomId);
            sendStateUpdate(gameRoomId);
        } catch (err) {
            console.log('create game failure ' + err);
        }
    });
    socket.on('joinGame', function(msg) {
        console.log('player ' + msg.name + ' trying to join room ' + msg.room);
        try {
            var playerId = addPlayerGameLobby(msg.name, msg.room);
            // add socket to game lobby
            addPlayerSocketIdToGameLobby(socket.id, msg.room, playerId)
            // send player their player id as sign that they've joined successfully
            io.to(socket.id).emit(msg.room, { joinGameSuccess: true, playerId: playerId });
            sendStateUpdate(msg.room);
        } catch (err) {
            console.log('join game failure ' + err);
            // send error to client that join game failed
            io.to(socket.id).emit('joinGameFailure', err);
        }
    });

    socket.on('move', function(params) {
        applyMove(params.gameRoom, params.move, params.answer, params.playerId);
    });
});

function sendStateUpdate(gameRoomId) {
    var gameRoom = getGameLobby(gameRoomId);
    if (gameRoom) {
        var gameState = gameRoom.gameState;
        var players = new Map(gameState.players);
        gameState.players = JSON.stringify(Array.from(players));
        io.sockets.emit(gameRoomId, { state: gameState });
        gameState.players = players;
    }
}

app.get('/', function(req, res) {
    res.sendFile(__dirname + '/public/default.html');
});

http.listen(port, function() {
    console.log(__dirname);
    console.log('listening on *: ' + port);
});
