Poker5 = {
    socket: null,

    betMode: false,

    cardsChangeMode: true,

    playerId: null,

    init: function() {
        if (window.location.protocol == "https:") {
            var ws_scheme = "wss://";
        }
        else {
            var ws_scheme = "ws://"
        }

        this.socket = new WebSocket(ws_scheme + location.host + "/poker5");

        this.socket.onopen = function() {
            $("#game-log").append($("<p></p>").text('Connected :)'));
        };

        this.socket.onclose = function() {
            $("#game-log").append($("<p></p>").text('Connection lost :('));
        };

        this.socket.onmessage = function(message) {
            var data = JSON.parse(message.data);

            console.log(data);

            switch (data.msg_id) {
                case 'connect':
                    Poker5.onConnect(data);
                    break;
                case 'disconnect':
                    Poker5.onDisconnect(data);
                    break;
                case 'set-cards':
                    Poker5.onSetCards(data);
                    break;
                case 'bet':
                    Poker5.onBet(data);
                    break;
                case 'game-update':
                    Poker5.onGameUpdate(data);
                    break;
            }
        };

        $('#player-control .card').click(function() {
            if (Poker5.cardsChangeMode) {
                $(this).toggleClass('selected');
            }
        });

        $('#change-cards-cmd').click(function() {
            cards = $('#player-control .card.selected');
            console.log(cards);
            Poker5.setCardsChangeMode(false);
        });

        $('#fold-cmd').click(function() {
            Poker5.socket.send(JSON.stringify({
                'msg_id': 'bet',
                'bet': -1
            }));
            Poker5.setBetMode(false);
        });

        $('#bet-cmd').click(function() {
            Poker5.socket.send(JSON.stringify({
                'msg_id': 'bet',
                'bet': $('#bet-input').val()
            }));
            Poker5.setBetMode(false);
        });

        this.setCardsChangeMode(false);
        this.setBetMode(false);
    },

    onGameUpdate: function(message) {
        if ($('#players .player').length == 0 || message.phase == 'new-game') {
            this.initGame(message);
        }
        else {
            this.updateGame(message);
        }

        switch (message.phase) {
            case 'new-game';
                break;
            case 'cards-assignment':
                break;
            case 'opening-bet':
                break;
            case 'cards-change':
                break;
            case 'final-bet':
                break;
            case 'show-cards':
                break;
            case 'winner-designation':
                break;
        }
    },

    onSetCards: function(message) {
        for (cardKey in message.cards) {
            Poker5.setCard(Poker5.playerId, cardKey + 1, message.cards[cardKey][0], message.cards[cardKey][1]);
        }
    },

    onBet: function(message) {
        Poker5.setBetMode(true);
    },

    onChangeCards: function(message) {
        this.setCardsChangeMode(true);
    },

    initGame: function(message) {
        $('#players').empty();

        for (key in message.players) {
            player = message.players[key];

            Poker5.players.push(player);

            $('#players').append(
                '<div class="player player-' + player.id + '">'
                + '<div class="cards row">'
                + '<div class="card small card-1 pull-left"></div>'
                + '<div class="card small card-2 pull-left"></div>'
                + '<div class="card small card-3 pull-left"></div>'
                + '<div class="card small card-4 pull-left"></div>'
                + '<div class="card small card-5 pull-left"></div>'
                + '</div>'
                + '<div class="player-info">'
                + '<span class="player-name">' + player.name + '</span>'
                + ' - '
                + '$<span class="player-money">' + player.money + '</span>'
                + '</div>'
                + '</div>');
        }
    },

    updateGame: function(message) {
        for (key in message.players) {
            $('.player.player-' + message.players[key].id + ' .player-money').text(message.player[key].money);
        }
    },

    setBetMode: function(betMode) {
        this.betMode = betMode;

        if (betMode) {
            $('#bet-group').show()
        }
        else {
            $('#bet-group').hide()
        }
    },

    setCardsChangeMode: function(changeMode) {
        this.cardsChangeMode = changeMode;

        if (changeMode) {
            $('#change-cards-cmd').show()
        }
        else {
            $('#change-cards-cmd').hide()
        }
    },

    setCard: function(playerId, cardId, rank, suit) {
        $('.player-' + playerId + ' .card-' + cardId).each(function() {
            $element = $(this);

            x = 0;
            y = 0;

            if ($element.hasClass('small')) {
                url = "static/images/cards-small.jpg";
                width = 45;
                height = 75;
            }
            else {
                url = "static/images/cards.jpg";
                width = 75;
                height = 125;
            }

            switch (suit) {
                case 0:
                    // Spades
                    x -= width;
                    y -= height;
                    break;
                case 1:
                    // Clubs
                    y -= height;
                    break;
                case 2:
                    // Diamonds
                    x -= width;
                    break;
                case 3:
                    // Hearts
                    break;
                default:
                    throw "Invalid suit";
            }

            if (rank < 1 || rank > 13) {
                throw "Invalid rank";
            }

            x -= (rank - 1) * 2 * width;

            $element.css('background-position', x + "px " + y + "px");
            $element.css('background-image', 'url(' + url + ')');

            $element.data('rank', rank)
            $element.data('suit', suit)
        })
    }
}

$(document).ready(function() {
    Poker5.init()

    /*
    Poker5.setCard(1, 1, 13, 2);
    Poker5.setCard(1, 2, 12, 2);
    Poker5.setCard(1, 3, 11, 2);
    Poker5.setCard(1, 4, 10, 2);
    Poker5.setCard(1, 5, 9, 2);

    Poker5.setCard(2, 1, 1, 3);
    Poker5.setCard(2, 2, 1, 2);
    Poker5.setCard(2, 3, 1, 1);
    Poker5.setCard(2, 4, 1, 0);
    Poker5.setCard(2, 5, 9, 2);
    $('.player-2').css('opacity', 0.5)

    Poker5.setCard(3, 1, 7, 2);
    Poker5.setCard(3, 2, 8, 2);
    Poker5.setCard(3, 3, 9, 3);
    Poker5.setCard(3, 4, 10, 1);
    Poker5.setCard(3, 5, 11, 1);
    $('.player-4').css('opacity', 0.5)

    // Simulate Player 4 fold
    $('.player-4 .card').css('opacity', 0.5);
    */
})


/*
var inbox = new ReconnectingWebSocket(ws_scheme + location.host + "/receive");
var outbox = new ReconnectingWebSocket(ws_scheme + location.host + "/submit");

inbox.onmessage = function(message) {
  var data = JSON.parse(message.data);
  $("#chat-text").append("<div class='panel panel-default'><div class='panel-heading'>" + $('<span/>').text(data.handle).html() + "</div><div class='panel-body'>" + $('<span/>').text(data.text).html() + "</div></div>");
  $("#chat-text").stop().animate({
    scrollTop: $('#chat-text')[0].scrollHeight
  }, 800);
};

inbox.onclose = function(){
    console.log('inbox closed');
    this.inbox = new WebSocket(inbox.url);

};

outbox.onclose = function(){
    console.log('outbox closed');
    this.outbox = new WebSocket(outbox.url);
};

$("#input-form").on("submit", function(event) {
  event.preventDefault();
  var handle = $("#input-handle")[0].value;
  var text   = $("#input-text")[0].value;
  outbox.send(JSON.stringify({ handle: handle, text: text }));
  $("#input-text")[0].value = "";
});
*/