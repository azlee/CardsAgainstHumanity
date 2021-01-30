'use strict';

/****************************************************************************
 * 
 * 
 * Utility functions
 * 
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
 * Given an array, return the number of non-empty elements in array.
 * @param {Array} arr
 * @returns {num} number of non empty elements in arr
 */
function getNumNonEmptyCards(arr) {
    var count = 0;
    for (var element of arr) {
        if (element) count++;
    }
    return count;
}

/**
 * Return the player with most points
 * @returns Player
 */
function getWinnerSoFar() {
    var playerIds = Array.from(GameState.players.keys());
    var winnerSoFar = getPlayer(playerIds[0]);
    for (var [_, player] of GameState.players) {
        if (player.score > winnerSoFar.score) {
            winnerSoFar = player;
        }
    }
    return winnerSoFar;
}

/**
 * Get the player object by name
 * @param {str} name 
 * @returns Player
 */
function getPlayerByName(name) {
    for (let [_, player] of GameState.players) {
        if (player.name === name) {
            return player;
        }
    }
    return null;
}

/**
 * Return the Player who played the winner card
 * @param {str} winnerCard 
 * @return Player who played the winnerCard
 */
function getWinnerPlayer(winnerCard) {
    for (let [_, player] of GameState.players) {
        if (player.finalCard === winnerCard) {
            return player;
        }
    }
    return null;
}

/**
 * Check if all the players drew a card (not including judge)
 */
function didEveryoneDraw() {
    for (let [_, player] of GameState.players) {
        if (player.role != PlayerRole.JUDGE && player.state != PlayerState.PLAYED_CARD) {
            return false;
        }
    }
    return true;
}

  
/****************************************************************************
 * 
 * 
 * Enumerations
 * 
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

const ModalType = {
    GAME_LOBBY: 'GAME_LOBBY',
    CREATE_NEW_GAME_FORM: 'CREATE_NEW_GAME_FORM',
    JOIN_EXISTING_GAME_FORM: 'JOIN_EXISTING_GAME_FORM',
    WINNING_CARD: "WINNING_CARD",
    PREVIEW_PLAYER_CARD_COMBOS:"PREVIEW_PLAYER_CARD_COMBOS"
}

const MoveType = {
    // only judge can choose winner
    CHOOSE_WINNER_CARD: "CHOOSE_WINNER_CARD",
    // only current judge can draw new question card
    DRAW_NEW_QUESTION: "DRAW_NEW_QUESTION",
    // only non judges can do these moves
    PLAY_ANSWER_CARD: "PLAY_ANSWER_CARD",
    DRAW_NEW_ANSWER: "DRAW_NEW_ANSWER"
}

const NotificationType = {
    // non card czar notifications
    PICK_ANSWER: "Answer the question",
    DRAW_NEW_CARD: "Draw new answer card to end your turn!",
    CARD_CZAR_CHOOSING: "Czar %s is choosing an answer...",

    // card czar notifications
    CHOOSE_FAVORITE_ANSWER: "Choose your favorite answer:",
    WAITING_FOR_OTHER_PLAYERS_TO_JOIN: "Waiting for more players to join..",
    YOURE_CARD_CZAR: "You're the card czar. Wait for players to play a card...",

    // card czar and non czar notifications
    WAITING_FOR_PLAYERS: "Waiting for all players to play a card...",
    DRAW_NEW_QUESTION_CARD: "Draw new question card to start new round"
}

const GameVersion = {
    PG:"PG",
    M: "M",
}

const GameVersionExplanation = {
    PG: "Family & work safe!",
    M: "Not for the faint of heart"
}

/****************************************************************************
 * 
 * 
 * GameState keeps track of all state in the game,
 * including players, status, all answers, scores, etc.
 * 
 * 
 ****************************************************************************/

let GameState = {
    // all unused answers
    answers: [],
    // answer cards in play (in center)
    answerCards: [],
    currentQuestion: null,
    discardAnswers: [],
    discardQuestions: [],
    judge: 1, // judge player index
    gameStatus: GameStatus.WAITING_FOR_ANSWERS,
    // total number of players
    numPlayers: 5,
    numCardsPerPlayer: 12,
    players: new Map(), // map of Players id -> player
    questions: [],
    roundNum: 1,
    winnerCard: null,
}

// the current player's id
var playerId = null;

/**
 * Add event listener to question draw pile
 */
function initializeQuestionDrawPile() {
    var questionPile = document.getElementById('question-draw-pile');
    questionPile.addEventListener("click", function(event) {
        applyMove(MoveType.DRAW_NEW_QUESTION, event);
    }, false);
}

/**
 * Get player with player id
 * @param {*} playerId 
 */
function getPlayer(playerId) {
    return GameState.players.get(playerId);
}

/****************************************************************************
 * 
 * 
 * Client side sockets
 * 
 * 
 ****************************************************************************/
var socket = io();

/**
 * Create a new game with first player with name
 * @param {str} name - name of first player
 * @param {GameVersion} version - rating of game - PG vs M
 */
function createGame(name, version) {
    socket.emit('createGame', { name: name.trim(), version: version });
    playerId = 0;
    initializeQuestionDrawPile();
    socket.on('createGameSuccess', function(gameRoom) {
        var modal = document.getElementById('myModal');
        modal.style.display = "none";
        listenToRoomNotifications(gameRoom)
    })
}

/**
 * Allow player with name name to join room with roomCode
 * @param {str} name 
 * @param {str} roomCode 
 */
function joinGame(name, roomCode) {
    roomCode = roomCode.trim().toUpperCase();;
    socket.emit('joinGame', { name: name, room: roomCode });
    listenToRoomNotifications(roomCode)

    socket.on('joinGameFailure', function(errorMsg) {
        var errorDiv = document.getElementById('formPlaceholder');
        errorDiv.innerHTML = errorMsg;
    })
}

/**
 * Listen to room socket messages
 * @param {*} roomCode 
 */
function listenToRoomNotifications(roomCode) {
    socket.on(roomCode, function(msg) {
        if (msg.state) {
            var prevGameState = Object.assign({}, GameState);
            GameState = msg.state;
            GameState.players = new Map(JSON.parse(msg.state.players))
            if (JSON.stringify(prevGameState) !== JSON.stringify(GameState)) {
                if (playerId != null) {
                    renderBoard(prevGameState);
                }
            }
        }
        if (msg.joinGameSuccess) {
            playerId = msg.playerId;
            var modal = document.getElementById('myModal');
            modal.style.display = "none";
            renderBoardWithoutPrevStateCheck();
            initializeQuestionDrawPile();
        }
    });
}

/**
 * Render the game lobby modal
 */
window.onload = function () {
    // render the game lobby join modal
    renderModal(ModalType.GAME_LOBBY);
};

/**
 * Apply a move by updating game state & rerendering board
 * @param {MoveType} move  - the MOVE that was applied
 * @param {*} event - the mouse click event
 */
// send moves to server via socket so they can update state
function applyMove(move, event) {
    var answer = event.target.innerHTML;
    var isJudge = playerId === GameState.judge;
    var player = getPlayer(playerId);
    var playerPlayed = player.state === PlayerState.PLAYED_CARD;
    var winnerChosen = GameState.gameStatus === GameStatus.WINNER_CHOSEN;
    var playerHasFullHand = getNumNonEmptyCards(player.cardsInHand) === GameState.numCardsPerPlayer;
    // verify that the player can make the specified move
    // if not then RETURN - we don't want to send invalid moves to server
    switch(move) {
        case MoveType.PLAY_ANSWER_CARD:
            // judge players can't do this
            if (isJudge || (!isJudge && playerPlayed)) {
                return;
            }
            break;
        case MoveType.DRAW_NEW_ANSWER:
            if (isJudge ||  (!isJudge && playerHasFullHand)) {
                return;
            }
            break;
        case MoveType.CHOOSE_WINNER_CARD:
            if (!isJudge || (isJudge && winnerChosen)) {
                return;
            }
            break;
        case MoveType.DRAW_NEW_QUESTION:
            // only draw new question if a winner has been choosen
            if (!winnerChosen) {
                return;
            }
        default:
            break;
    }
    socket.emit('move', {
        answer: answer,
        gameRoom: GameState.gameId,
        move: move,
        playerId: playerId,
    });
}

/****************************************************************************
 * 
 * 
 * All methods that render/update DOM elements based on game state.
 * 
 * 
 ****************************************************************************/

/**
 * Reveal answer cards in middle by "flipping" them over.
 */
function revealAnswers() {
    GameState.gameStatus = GameStatus.ALL_CARDS_REVEALED;
}

/**
 * Render the question card.
 */
function renderQuestionCard() {
    var prevQuestion = document.getElementById('active-question').innerHTML;
    var currQuestion = GameState.currentQuestion.replace("%s", "____________");
    if (prevQuestion !== currQuestion)
    $("#active-question").html('').hide("clip", {direction: "horizontal"}, 300, function() {
        $(this).show("clip", {direction: "horizontal"}, 300);
    });
    setTimeout(function() {
        $("#active-question").html(currQuestion);
    }, 600);
}

/**
 * Render the score board including header
 */
function renderScoreBoard() {
    var scoreBoard = document.getElementById('score-board-table');
    var header = document.createElement('tr');
    header.innerHTML = '';
    // display crown next to winner so far (includes ties)
    var winnerSoFar = getWinnerSoFar();
    for (let [_, player] of GameState.players) {
        var displayCrown = winnerSoFar.score > 0 && (winnerSoFar === player || player.score === winnerSoFar.score);
        var crown = displayCrown ? '&#9812; ' : '';
        header.innerHTML = header.innerHTML + '<th>' + crown + player.name + '</th>';
    }
    scoreBoard.removeChild(scoreBoard.childNodes[0]);
    scoreBoard.prepend(header);
    renderScores();
}
/**
 * Render the scores in score board
 */
function renderScores() {
    var scoreBoard = document.getElementById('scores');
    scoreBoard.innerHTML = '';
    for (let [id, player] of GameState.players) {
        var scoreCell = document.createElement('td');
        scoreCell.innerHTML = player.score;
        scoreBoard.append(scoreCell);
    }
}

/**
 * Render the round number & game room
 */
function renderRoundNumber() {
    var roundDiv = document.getElementById('round-number');
    roundDiv.innerHTML = 'Room ' + GameState.gameId; 
}

/**
 * Render the current judge name
 */
function renderJudge() {
    var judgeDiv  = document.getElementById('judge-name');
    judgeDiv.innerHTML = getPlayer(GameState.judge).name + "'s question:";
}

/**
 * Render the notification that indicates what player should be doing
 * Notification for non card czars:
 * a) Pick the funniest answer for the question
 * b) Waiting for all players to play a card
 * c) Card czar is choosing an answer
 * d) Draw new question card to start new round
 * 
 * Notification for card czar:
 * 
 * a) Waiting for all players to play a card
 * b) Choose your favorite answer
 * c) Draw new question card to start new round;
 */
function renderNotification() {
    var notificationDiv  = document.getElementById('notification');
    var allAnswersSubmitted = didEveryoneDraw() && GameState.players.size > 1;
    var isJudge = GameState.judge === playerId;
    var cardCzarName = getPlayer(GameState.judge).name;
    var didPlayerNotPlay = getPlayer(playerId).state === PlayerState.NOT_PLAYED_CARD;
    var didPlayerPlay = getPlayer(playerId).state === PlayerState.PLAYED_CARD;
    var winnerChosen = GameState.winnerCard != null;
    var notification = '';
    if (!isJudge) {
        if (didPlayerNotPlay) {
            notification = NotificationType.PICK_ANSWER;
        } else if (didPlayerPlay && !allAnswersSubmitted) {
            notification = NotificationType.WAITING_FOR_PLAYERS;
        } else if (allAnswersSubmitted && !winnerChosen) {
            notification = NotificationType.CARD_CZAR_CHOOSING.replace("%s", cardCzarName);
        } else if (allAnswersSubmitted && winnerChosen) {
            notification = NotificationType.DRAW_NEW_QUESTION_CARD;
        }
    } else {
        if (GameState.players.size === 1) {
            notification = NotificationType.WAITING_FOR_OTHER_PLAYERS_TO_JOIN;
        } else if (!allAnswersSubmitted && GameState.players.size > 1) {
            notification = NotificationType.YOURE_CARD_CZAR;
        } else if (allAnswersSubmitted && !winnerChosen) {
            notification = NotificationType.CHOOSE_FAVORITE_ANSWER;
        } else if (allAnswersSubmitted && winnerChosen) {
            notification = NotificationType.DRAW_NEW_QUESTION_CARD;
        }
    }
    if (notificationDiv.innerHTML !== notification) {
        $("#notification").fadeOut(250, function() {
            $(this).html(notification).fadeIn(250);
        });
    }
}

/**
 * Creates a card combo
 * 1) If the question is a fill-in-the-blank question - only display a black card with the answer filled in.
 * 2) Else display the black question card and the white answer card beside it
 * @param {str} question
 * @param {str} answer 
 */
function createCardCombo(question, answer) {
    var cardHolder = document.createElement('div');
    cardHolder.className = 'card-combo';
    var cardDiv = createFaceUpNonactiveAnswerCard(answer);
    var isFillInBlankQ = question.includes("%s");
    if (isFillInBlankQ) {
        var blankReplacement = " <span style='text-decoration: underline;font-weight:900'>" + answer.substring(0, answer.length - 1) +  "</span> ";
        cardDiv.style = "background-color: black; color: white;"
        cardDiv.innerHTML = question.replace("%s", blankReplacement);
    } else {
        cardDiv.innerHTML = answer;
    }
    cardHolder.appendChild(cardDiv);
    // if not fill in blank question then also display the question
    if (!isFillInBlankQ) {
        var questionCardDiv = createFaceUpQuestionCard(question);
        cardHolder.prepend(questionCardDiv);
    }
    return cardHolder;
}

/**
 * Render the answer cards in center.
 * Ensure that the active player's cards is flipped up if they haven't drawn a new card yet.
 * Else ensure all the cards are flipped over
 */
function renderCardsInPlay() {
    let finalAnswers = document.getElementById('final-answers');
    finalAnswers.innerHTML = '';
    var cardNum = 0;
    if (didEveryoneDraw() || GameState.gameStatus === GameStatus.WINNER_CHOSEN) {
        for (var answerCard of GameState.answerCards) {
            var faceUpAnswer = playerId === GameState.judge ? createFaceUpAnswerCard(answerCard) : createFaceUpNonactiveAnswerCard(answerCard);
            if (GameState.gameStatus != GameStatus.WINNER_CHOSEN) { 
                faceUpAnswer.addEventListener("click", function(event) {
                    applyMove(MoveType.CHOOSE_WINNER_CARD, event);
                }, false);
            } else if (GameState.winnerCard && GameState.winnerCard === answerCard) {
                faceUpAnswer.className += " winning-card";
            }
            faceUpAnswer.id = "answerCard-" + cardNum;
            finalAnswers.appendChild(faceUpAnswer);
        }
    } else {
        for (var [_, player] of GameState.players) {
            var answerCard = player.finalCard;
            if (!player.finalCard && GameState.judge !== player.id) {
                // create placeholder with the player's name
                var placeholder = createCardPlayerPlaceHolder(player.name);
                placeholder.id = "answerCard-" + cardNum;
                finalAnswers.appendChild(placeholder);
            } else if (GameState.judge !== player.id) {
                if (answerCard && GameState.gameStatus != GameStatus.ALL_CARDS_REVEALED) {
                    var card = createFaceDownAnswerCard();
                    card.id = "answerCard-" + cardNum;
                    finalAnswers.appendChild(card);
                }
            }
            cardNum++;
        }
    }
    // if all the players have minus judge are in drew new card state then reveal
    if (didEveryoneDraw() && GameState.gameStatus != GameStatus.WINNER_CHOSEN) {
        revealAnswers();
    }
}

/**
 * Render the active player's answer cards
 */
function renderActivePlayersCards() {
    var playerHand = document.getElementById('active-player-cards');
    // TODO: remove this once multiplayer is set up
    var currentPlayerHeader = document.getElementById('currentPlayer');
    var player = getPlayer(playerId);
    currentPlayerHeader.innerHTML = player.name;
    playerHand.innerHTML = '';
    var i = 0;
    for (var card of player.cardsInHand) {
        if (card) {
            var answerCard = playerId === GameState.judge ? createFaceUpPlaceholderAnswerCard(card) : createFaceUpAnswerCard(card);
            answerCard.id = 'card-' + i;
            answerCard.addEventListener("click", function(event) {
                applyMove(MoveType.PLAY_ANSWER_CARD, event);
            }, false);
            playerHand.appendChild(answerCard);
        } else { // create placeholder
            playerHand.appendChild(createCardPlaceHolder());
        }
        i++;
    }
}

/**
 *  Render modal either for
 *  a) Game lobby
 *  b) Winning card
 *  c) displaying a player's winning card combos
 * @param modalType: type of modal to display
 * @playerPreview playerName: if modal is PREVIEW_PLAYER_CARD_COMBOS then playerName
 *                      is the name of player whose cards we want to display in modal
 */
function renderModal(modalType, playerPreview=null) {
    var modal = document.getElementById('myModal');
    var modalContent = document.getElementById('modal-content');
    modalContent.innerHTML = '<span class="close">&times;</span>';
    if (modalType === ModalType.GAME_LOBBY) {
        modalContent.innerHTML = '';
        var modalHeader = '<h4 style="font-size:1.5rem;font-weight:bold;center;letter-spacing:-1px">';
        modalHeader += 'Cards Against Humanity';
        modalHeader += "</h4>";
        modalContent.innerHTML += modalHeader;
        modalContent.appendChild(createOptionForm());
    } else if (modalType === ModalType.JOIN_EXISTING_GAME_FORM || modalType === ModalType.CREATE_NEW_GAME_FORM) {
        modalContent.innerHTML = '';
        var newGame = modalType === ModalType.CREATE_NEW_GAME_FORM;
        var modalHeader = '<h4 style="font-size:1.5rem;font-weight:bold;center;letter-spacing:-1px">';
        modalHeader += (newGame ? 'Create new game' : 'Join existing game');
        modalHeader += "</h4>";
        modalContent.innerHTML += modalHeader;
        modalContent.appendChild(createPlayForm(newGame));
        addDisableEnableButton();
    } else if (modalType === ModalType.WINNING_CARD) {
        var winnerPlayer = getWinnerPlayer(GameState.winnerCard);
        var winnerStatement = '<h4 style="font-size:1.25rem;center;letter-spacing:0.15rem">';
        winnerStatement += winnerPlayer.id === playerId ? "You won!" : "Winner is " + winnerPlayer.name + '!';
        winnerStatement += "</h4>";
        modalContent.innerHTML += winnerStatement;
        var cardHolder = createCardCombo(GameState.currentQuestion, GameState.winnerCard);
        modalContent.appendChild(cardHolder);
    } else if (modalType === ModalType.PREVIEW_PLAYER_CARD_COMBOS) {
        // display all the winning card combos in the modal
        var comboHolder = document.createElement('div');
        comboHolder.className = 'card-holder';
        var modalHeader = '<h4 style="font-size:1.25rem;center;letter-spacing:0.15rem">';
        modalHeader += playerPreview + "'s winning cards";
        modalHeader += "</h4>";
        modalContent.innerHTML += modalHeader;
        var winningCombosDiv = document.createElement('div');
        winningCombosDiv.className = 'card-holder';
        var winningAnswers = getPlayerByName(playerPreview).winningAnswers;
        var winningQuestions = getPlayerByName(playerPreview).winningQuestions;
        var zip = (a,b) => a.map((x,i) => [x,b[i]]);
        for (let [answer, question] of zip(winningAnswers, winningQuestions)) {
            winningCombosDiv.appendChild(createCardCombo(question, answer));
        }
        modalContent.appendChild(winningCombosDiv);
    }
    if (modalType === ModalType.JOIN_EXISTING_GAME_FORM || modalType === ModalType.GAME_LOBBY || modalType === ModalType.CREATE_NEW_GAME_FORM) {
        modal.style.display = "block";
        return;
    }
    var span = document.getElementsByClassName("close")[0];
    span.addEventListener("click", function(event) {
        modal.style.display = "none";
    }, false);
    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    }
    modal.style.display = "block";
}

/**
 * Render the player preview cards on the sides
 */
function renderPlayerPreviewCards() {
    var players = GameState.players;
    var playerIds = Array.from(GameState.players.keys());
    var numPlayers = playerIds.length
    // put half of the players preview cards on left
    var playerPreviewLeft = document.getElementById('player-preview-left');
    playerPreviewLeft.innerHTML = '';
    for (var i = 0; i < (numPlayers / 2); i++) {
        var player = players.get(playerIds[i]);
        playerPreviewLeft.appendChild(createPlayerPreviewCard(player.name, player.role, player.state));
    }
    // put other half of the players preview cards on right
    var playerPreviewRight = document.getElementById('player-preview-right');
    playerPreviewRight.innerHTML = '';
    for (var i = Math.ceil(numPlayers / 2); i < numPlayers; i++) {
        var player = players.get(playerIds[i]);
        playerPreviewRight.appendChild(createPlayerPreviewCard(player.name, player.role, player.state));
    }
}

/**
 * Render the entire board without checking previous game state
 */
function renderBoardWithoutPrevStateCheck() {
    renderQuestionCard();
    renderActivePlayersCards();
    renderPlayerPreviewCards();
    renderCardsInPlay();
    renderScoreBoard();
    renderRoundNumber();
    renderJudge();
    renderNotification();
}

/**
 * Render the entire board
 * Only render components where the game state has changed
 * @param: {*} - prevState previous game state
 */
function renderBoard(prevState) {
    var questionChanged = GameState.currentQuestion != prevState.currentQuestion;
    var judgeChanged = GameState.judge != prevState.judge;
    var cardHandChanged = !prevState.players.get(playerId) || getPlayer(playerId).cardsInHand != prevState.players.get(playerId).cardsInHand;
    var finalCardChanged = !prevState.players.get(playerId) || GameState.players.get(playerId).finalCard != prevState.players.get(playerId).finalCard;
    var playersChanged = JSON.stringify(Array.from(GameState.players)) != JSON.stringify(Array.from(prevState.players));
    var cardsInPlayChanged = GameState.answerCards != prevState.answerCards;
    var statusChange = GameState.gameStatus != prevState.gameStatus;
    var winnerCardChanged = GameState.winnerCard != prevState.winnerCard;
    var roundChanged = GameState.roundNum != prevState.roundNum;
    var gameIdChanged = GameState.gameId != prevState.gameId;
    if (questionChanged) {
        renderQuestionCard();
    }
    if (judgeChanged || cardHandChanged) {
        renderActivePlayersCards();
    }
    if (playersChanged) {
        renderPlayerPreviewCards();
    }
    if (playersChanged || cardsInPlayChanged || statusChange) {
        renderCardsInPlay();
    }
    if (winnerCardChanged && GameState.winnerCard) {
        renderModal(ModalType.WINNING_CARD);
    };
    if (playersChanged) {
        renderScoreBoard();
    }
    if (roundChanged || gameIdChanged) {
        renderRoundNumber();
    }
    if (judgeChanged) {
        renderJudge();
    }
    if (judgeChanged || cardsInPlayChanged || winnerCardChanged || finalCardChanged || playersChanged) {
        renderNotification();
    }
}

/****************************************************************************
 * 
 * 
 * All methods that create & return card divs
 * 
 * 
 ****************************************************************************/

/**
 * Create the option form for either creating new game or joining existing game
 */
function createOptionForm() {
    var div = document.createElement('div');
    var createNewGameButton = document.createElement('button');
    var joinExistingButton = document.createElement('button');
    // add action to button
    createNewGameButton.addEventListener("click", function(event) {
        renderModal(ModalType.CREATE_NEW_GAME_FORM)
    }, false);
    joinExistingButton.addEventListener("click", function(event) {
        renderModal(ModalType.JOIN_EXISTING_GAME_FORM)
    }, false);
    createNewGameButton.innerHTML = 'CREATE NEW GAME';
    joinExistingButton.innerHTML = 'JOIN EXISTING GAME';
    var img = document.createElement('img');
    img.src = 'geneWilder2.jpg';
    div.appendChild(img);
    div.appendChild(document.createElement('br'));
    div.appendChild(createNewGameButton);
    div.appendChild(document.createElement('br'));
    div.appendChild(joinExistingButton);
    div.style = "margin-bottom: 2rem;"
    return div;
}

/**
 * Create form for joining of creating new game
 * @param {boolean} newGame - true if we are creating new game. false if joining existing game
 */
function createPlayForm(newGame) {
    var formDiv = document.createElement('form');
    var nameLabel = document.createElement('label');
    nameLabel.innerHTML = 'Name: ';
    var nameInput = document.createElement('input');
    nameInput.id = 'nameInput';
    nameInput.maxLength = "15" 
    nameInput.placeholder = "ENTER YOUR NAME";
    var img = document.createElement('img');
    img.src = 'geneWilder2.jpg';
    // select for clean/non clean version
    var cleanLabel = document.createElement('label');
    cleanLabel.innerHTML = 'Rating:';
    cleanLabel.id = 'cleanLabel';
    var cleanSelect = document.createElement('select');
    cleanSelect.id = 'cleanSelect';
    for (const key in GameVersion) {
        var option = document.createElement('option');
        console.log(GameVersion[key]);
        option.value = GameVersion[key];
        option.innerHTML = GameVersion[key] + " - " + GameVersionExplanation[key];
        cleanSelect.appendChild(option);
    }
    formDiv.appendChild(img);
    formDiv.appendChild(document.createElement('br'));
    formDiv.appendChild(document.createElement('br'));
    formDiv.appendChild(nameLabel);
    formDiv.appendChild(nameInput);
    formDiv.appendChild(document.createElement('br'));
    if (newGame) {
        formDiv.appendChild(cleanLabel);
        formDiv.appendChild(cleanSelect);
        formDiv.appendChild(document.createElement('br'));
    }
    if (!newGame) {
        var codeLabel = document.createElement('label');
        codeLabel.innerHTML = 'Room code: ';
        var codeInput = document.createElement('input');
        codeInput.id = 'roomCodeInput';
        codeInput.maxLength = "4";
        codeInput.size = "22";
        codeInput.placeholder = "ENTER 4-LETTER CODE"
        formDiv.appendChild(codeLabel);
        formDiv.appendChild(codeInput);
    }
    formDiv.appendChild(document.createElement('br'));
    // error msg placeholder
    var msgPlaceholder = document.createElement('p');
    msgPlaceholder.id = 'formPlaceholder';
    msgPlaceholder.style = "color:#D8000C;font-size:1rem;padding-left:1rem;padding-right:1rem;"
    formDiv.appendChild(msgPlaceholder);
    var button = document.createElement('button');
    button.type = 'button'
    button.id = 'joinOrCreateGame';
    button.innerHTML = newGame ? 'CREATE GAME' :'JOIN GAME';
    button.disabled = true;
    if (newGame) {
        button.addEventListener("click", function(event) {
            createGame(document.getElementById('nameInput').value, document.getElementById('cleanSelect').value);
        });
    } else {
        button.addEventListener("click", function(event) {
            joinGame(document.getElementById('nameInput').value, document.getElementById('roomCodeInput').value);
        }, false);
    }
    formDiv.append(button);
    return formDiv;
}

/**
 * Enable or disable button for joining or creating game if input is incorrect
 * ex. if input for name has numbers
 *     or if the room code isn't 4 characters
 */
function addDisableEnableButton() {
    $('#joinOrCreateGame').prop('disabled', true);
    var roomCodeButton = document.getElementById('roomCodeInput') !== null;
  
    function validateNextButton() {
      var isNameEntered = $('#nameInput').val().trim() !== '';
      var isRoomCodeEntered = !roomCodeButton || ($('#roomCodeInput').val().trim().length === 4);
      $('#joinOrCreateGame').prop('disabled', !isNameEntered || !isRoomCodeEntered);
    }
  
    $('#nameInput').on('keyup', validateNextButton);
    if (roomCodeButton) {
        $('#roomCodeInput').on('keyup', validateNextButton);
    }
};

/**
 * Create an individual player preview card that includes the player name
 * @returns {div} - player preview card div with player name inside
 */
function createPlayerPreviewCard(playerName, playerRole, playerState) {
    var card = document.createElement('div');
    card.className = 'card nonactive-answer';
    // check mark indicates if non judge player has played & drew card
    var checkMark = (playerState === PlayerState.DREW_NEW_CARD) ? ' &#10003;' : '';
    var appendPlayerPreview = (playerRole === PlayerRole.JUDGE) ? '' : checkMark;
    var prependPlayerPreview = (playerRole === PlayerRole.JUDGE) ? 'CZAR: ' : '';
    card.innerHTML = prependPlayerPreview + playerName + appendPlayerPreview;
    card.addEventListener("click", function() {
        renderModal(ModalType.PREVIEW_PLAYER_CARD_COMBOS, playerName);
    }, false)
    return card;
}

/**
 * Creates a card place holder.
 * @returns {div} - card placeholder
 */
function createCardPlaceHolder() {
    var emptyCard = document.createElement('div');
    emptyCard.className = 'card placeholder';
    return emptyCard;
}

/**
 * Creates a card place holder with playerName in center.
 * @param {str} playerName - name of player name to display in card center
 * @returns {div} - card placeholder
 */
function createCardPlayerPlaceHolder(playerName) {
    var emptyCard = document.createElement('div');
    emptyCard.className = 'card placeholder-player-name ';
    emptyCard.innerHTML = playerName;
    return emptyCard;
}

/**
 * Creates an answer card face up div
 * @returns {div} - face up answer card
 */
function createFaceUpAnswerCard(answer) {
    var answerCard = document.createElement('div');
    answerCard.innerHTML = answer;
    answerCard.className = 'card answer';
    return answerCard;
}

/**
 * Creates an answer card face down
 * @returns {div} - face down answer card
 */
function createFaceDownAnswerCard() {
    var answerCard = document.createElement('div');
    answerCard.innerHTML = "Cards Against Humanity";
    answerCard.className = 'card nonactive-answer back';
    return answerCard;
}

/**
 * Creates a non-active answer placeholder card face up div (no hover effect)
 * This will be displayed for the current judge so they
 * know they don't have to play a card
 * @returns {div} - non-active face up answer card
 */
function createFaceUpPlaceholderAnswerCard(answer) {
    var answerCard = document.createElement('div');
    answerCard.innerHTML = answer;
    answerCard.className = 'card placeholder';
    return answerCard;
}

/**
 * Creates a non-active answer card face up div (no hover effect)
 * @returns {div} - non-active face up answer card
 */
function createFaceUpNonactiveAnswerCard(answer) {
    var answerCard = document.createElement('div');
    answerCard.innerHTML = answer;
    answerCard.className = 'card nonactive-answer';
    return answerCard;
}

/**
 * Creates a question card face up div
 * @returns {div} - face up question card
 */
function createFaceUpQuestionCard(question) {
    var questionCard = document.createElement('div');
    questionCard.innerHTML = question;
    questionCard.className = 'card question';
    return questionCard;
}