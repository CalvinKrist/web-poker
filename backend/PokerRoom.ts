import { Client, Room } from "colyseus";
import { GameState } from "../state/GameState";
import { Player } from "../state/Player";
import { ArraySchema } from "@colyseus/schema";
import { ReadyState } from "../messages/readystate";
import { ErrorMessage } from "../messages/error";
import { FOLD, CALL, RAISE, ALL_IN, Raise } from "../messages/playeraction";
import { Deck } from "../state/Deck";
import * as HandComparer from "./HandComparer";
import { Card } from "../state/Card";

class WinnerInfo {
    winners: Player[]
    winningMessage: string

    constructor(winners: Player[], comparison: number[]) {
        this.winners = winners;
        this.winningMessage = "Congratulations " + winners[0].id;

        for(let i = 1; i < winners.length; i++) {
            this.winningMessage += " and " + winners[i].id;
        }

        this.winningMessage += "!";
    }
}

export enum Gamestate {
    Preround,  // round hasn't started yet
    Preflop,
    Flop,
    Turn,
    River,
    EndGame
}

export class PokerRoom extends Room<GameState> {
    gameState: Gamestate;
    currentBet: number;
    lastRaise: number;
    currentPlay: string;
    deck: Deck;
    toDelete: string[];
    spectators: Player[]

    constructor() {
        super();
        this.maxClients = 6;
        this.gameState = Gamestate.Preround;
        this.currentBet = 0;
        this.lastRaise = 0.5;
        this.currentPlay = ""; // tracks which player the play comes off of, ie the last player to bet
        this.toDelete = [];
        this.deck = new Deck();
        
        this.spectators = [];
    }

    private allPlayersReady(): boolean {
        for (const player of this.state.player_map.values()) {
            if (!player.isReady) {
                return false;
            }
        }

        return true;
    }

    private sleep(num_millis: number, callback: Function) {
        this.clock.start();

        let d = this.clock.setTimeout(() => {
            this.clock.stop();
            d.clear();
            callback();
        }, num_millis);
        return;
    }

    private getNextPlayer(player: Player) {
        let active_players = Array.from(this.state.player_order).filter(id => this.state.player_map.get(id).inRound).map(id => this.state.player_map.get(id));
        return active_players[(active_players.indexOf(player) + 1) % active_players.length]
    }

    private getCurrentPlayer(): Player | { id: string; } {
        let id = Array.from(this.state.player_order).filter(id => this.state.player_map.get(id).isTurn)[0];
        if(this.state.player_map.has(id)) {
            return this.state.player_map.get(id);
        }
        return {
            id:  null
        }
    }

    private numPlayersInRound() {
        return this.getPlayersInRound().length;
    }

    private getPlayersInRound(): Array<Player> {
        return Array.from(this.state.player_map.values()).filter(player => player.inRound);
    }

    private numPlayersAllIn() {
        return Array.from(this.state.player_map.values()).filter(player => player.bb == 0 && player.inRound).length;
    }

    private incrementPlayerTurn(player: Player, leaveRound: boolean = false) {
        let next_player = this.getNextPlayer(player);
        player.isTurn = false;
        next_player.isTurn = true;

        if (leaveRound) {
            player.inRound = false;
        }

        //console.log("incrementPlayerTurn")
    }

    // TODO: add unit tests for the logic of going around the table
    /*
    Transitions the state if we have gone all the way around the table
    */
    private transitionIfNeeded() {
        if (this.getCurrentPlayer().id == this.currentPlay) {
            if(this.numPlayersInRound() - this.numPlayersAllIn() <= 1) {
                this.allInSequence();
            } else {
                if (this.gameState == Gamestate.Preflop) {
                    this.transitionState(Gamestate.Flop);
                } else if (this.gameState == Gamestate.Flop) {
                    this.transitionState(Gamestate.Turn);
                } else if (this.gameState == Gamestate.Turn) {
                    this.transitionState(Gamestate.River);
                } else if (this.gameState == Gamestate.River) {
                    this.transitionState(Gamestate.EndGame);
                }
            }
        }
        //console.log("transitionIfNeeded")
    }

    private disablePlayerTurns() {
        for(let player of this.state.player_map.values()) {
            player.isTurn = false;
        }
    }

    private allInSequence() {
        this.disablePlayerTurns();
        for(let player of this.getPlayersInRound()) {
            player.shouldShowHand = true;
        }

        if (this.gameState == Gamestate.Preflop) {
            this.transitionState(Gamestate.Flop);
            this.disablePlayerTurns();
            this.flush();
            this.sleep(2000, () => {
                this.allInSequence();
            });
        } else if (this.gameState == Gamestate.Flop) {
            this.transitionState(Gamestate.Turn);
            this.disablePlayerTurns();
            this.flush();
            this.sleep(2000, () => {
                this.allInSequence();
            });
        } else if (this.gameState == Gamestate.Turn) {
            this.transitionState(Gamestate.River);
            this.disablePlayerTurns();
            this.flush();
            this.sleep(2000, () => {
                this.allInSequence();
            });
        } else if (this.gameState == Gamestate.River) {
            this.transitionState(Gamestate.EndGame);
        }
    }

    private nextStatePostFlop(numCardsToDeal: number) {
        this.currentBet = 0;
        this.lastRaise = 0;

        for (let i = 0; i < numCardsToDeal; i++) {
            this.state.board.push(this.deck.deal());
        }

        this.state.player_map.forEach((player) => { player.currentBet = 0; player.isTurn = false; })

        let dealer = Array.from(this.state.player_map.values()).filter(player => player.isDealer)[0];
        let dealer_index = this.state.player_order.indexOf(dealer.id);
        let sb_index = dealer_index; // In heads-up poker, dealer is SB and the other player is BB
        if (this.state.player_order.length > 2) {
            sb_index = (dealer_index + 1) % this.state.player_order.length;
        }

        // The sb might not be in the game any more so we need to find the next player
        let active_player = null;
        let i = sb_index;
        while (active_player == null) {
            let p_id = this.state.player_order[i % this.state.player_order.length];
            if (this.state.player_map.get(p_id).inRound) {
                active_player = this.state.player_map.get(p_id)
            } else {
                i++;
            }
        }

        active_player.isTurn = true;
        this.currentPlay = active_player.id;

        //console.log("nextStatePostFlop")
    }

    private determineWinners() {
        // If there is a single winner due to folding...
        if (this.numPlayersInRound() == 1) {
            return new WinnerInfo([Array.from(this.state.player_map.values()).filter(player => player.inRound)[0]], []);
        }

        let remainingPlayers = Array.from(this.state.player_map.values()).filter(player => player.inRound);
        for(let player of remainingPlayers) {
            player.bestHand = HandComparer.getPlayersBestHand(player.hand, this.state.board);
        }

        let winningPlayers = [remainingPlayers[0]];
        let winningComparison = null;
        for(let i = 1; i < remainingPlayers.length; i++) {
            let comparison = HandComparer.compareHand(remainingPlayers[i].bestHand, winningPlayers[0].bestHand)
            if(comparison[0] == 1) {
                winningPlayers = [remainingPlayers[i]];
                winningComparison = comparison;
            } else if(comparison[0] == 0) {
                winningPlayers.push(remainingPlayers[i]);
            }
        }

        return new WinnerInfo(winningPlayers, winningComparison);
    }

    private transitionState(nextState: Gamestate) {
        if (this.gameState == Gamestate.Preround && nextState == Gamestate.Preflop) {

            this.state.running = true;
            // Assign a dealer if there wasn't one already. Otherwise, increment dealer
            let dealer_arr = Array.from(this.state.player_map.values()).filter(player => player.isDealer)
            if (dealer_arr.length == 0) {
                this.state.player_map.get(this.state.player_order[0]).isDealer = true;
            } else {
                let old_dealer_indx = this.state.player_order.indexOf(dealer_arr[0].id);
                dealer_arr[0].isDealer = false;
                let new_idealer_id = this.state.player_order[(old_dealer_indx + 1) % this.state.player_order.length];
                this.state.player_map.get(new_idealer_id).isDealer = true;
            }

            for (let [player_id, player] of this.state.player_map.entries()) {
                player.hand.push(this.deck.deal());
                player.hand.push(this.deck.deal());
                player.inRound = true;
            }

            // Put out blinds
            this.state.pot += 1.5;
            let dealer = Array.from(this.state.player_map.values()).filter(player => player.isDealer)[0];
            let dealer_index = this.state.player_order.indexOf(dealer.id);
            if (this.state.player_order.length == 2) {
                // In heads-up poker, dealer is SB and the other player is BB
                dealer.bb -= 0.5;
                dealer.currentBet = 0.5;
                let bb_id = this.state.player_order[(dealer_index + 1) % this.state.player_order.length];
                this.state.player_map.get(bb_id).bb -= 1;
                this.state.player_map.get(bb_id).currentBet = 1;
            } else {
                let sb_id = this.state.player_order[(dealer_index + 1) % this.state.player_order.length];
                let bb_id = this.state.player_order[(dealer_index + 2) % this.state.player_order.length];
                this.state.player_map.get(sb_id).bb -= 0.5;
                this.state.player_map.get(sb_id).currentBet = 0.5;
                this.state.player_map.get(bb_id).bb -= 1;
                this.state.player_map.get(bb_id).currentBet = 1;
            }

            // Set the current player's turn
            let offset = this.state.player_order.length == 2 ? 0 : 3;
            let starting_player_id = this.state.player_order[(dealer_index + offset) % this.state.player_order.length];
            this.state.player_map.get(starting_player_id).isTurn = true;
            this.currentPlay = this.state.player_map.get(starting_player_id).id;

            this.currentBet = 1;
            this.lastRaise = 0.5;

            this.gameState = nextState;
        } else if (this.gameState == Gamestate.Preflop && nextState == Gamestate.Flop) {
            this.nextStatePostFlop(3);
            this.gameState = nextState;
        } else if (this.gameState == Gamestate.Flop && nextState == Gamestate.Turn) {
            this.nextStatePostFlop(1);
            this.gameState = nextState;
        } else if (this.gameState == Gamestate.Turn && nextState == Gamestate.River) {
            this.nextStatePostFlop(1);
            this.gameState = nextState;
        } else if (nextState == Gamestate.EndGame) {
            let gameResults = this.determineWinners();
            this.state.winners = gameResults.winners;
            this.state.winningMessage = gameResults.winningMessage;

            for(let player of gameResults.winners) {
                player.bb += this.state.pot / gameResults.winners.length;
            }

            this.state.pot = 0;
            this.state.running = false;

            if(this.gameState == Gamestate.River && this.numPlayersInRound() > 1) {
                for(let player of this.getPlayersInRound()) {
                    player.shouldShowHand = true;
                }
            }
            this.state.player_map.forEach((player) => {
                player.isTurn = false;
                player.isReady = false;
            })

            this.gameState = nextState;

            // Determine players who need to be kicked: sb/bb/other are < 1.5/2/1
            let dealer = Array.from(this.state.player_map.values()).filter(player => player.isDealer)[0];
            let next_dealer_index = (this.state.player_order.indexOf(dealer.id) + 1) % this.state.player_order.length;

            let sb_id = this.state.player_order[(next_dealer_index + 1) % this.state.player_order.length];
            let bb_id = this.state.player_order[(next_dealer_index + 2) % this.state.player_order.length];
            if (this.state.player_order.length == 2) {
                sb_id = dealer.id
                sb_id = this.state.player_map.get(this.state.player_order[(next_dealer_index + 1) % 2 ]).id;
            } 
                
            let player_ids = this.state.player_order.map(x => x);

            for(let id of player_ids) {
                let player = this.state.player_map.get(id);
                if(id == sb_id && player.bb  < 1.5) {
                    this.spectators.push(player);
                    this.state.player_map.delete(id);
                    this.state.player_order.splice(this.state.player_order.indexOf(id), 1);
                    this.state.numSpectators += 1;
                } else if(id == bb_id && player.bb  < 2) {
                    this.spectators.push(player);
                    this.state.player_map.delete(id);
                    this.state.player_order.splice(this.state.player_order.indexOf(id), 1);
                    this.state.numSpectators += 1;
                }
                else if(player.bb  < 1) {
                    this.spectators.push(player);
                    this.state.player_map.delete(id);
                    this.state.player_order.splice(this.state.player_order.indexOf(id), 1);
                    this.state.numSpectators += 1;
                }
            }
        } else if (this.gameState == Gamestate.EndGame && nextState == Gamestate.Preflop) {
            this.gameState = Gamestate.Preround;
            this.reset();
            this.transitionState(Gamestate.Preflop);
        } else if(this.gameState == Gamestate.Preflop && nextState == Gamestate.Preflop) {
            console.log("Preflop --> Preflop: resetting instead.");
            this.reset();
            this.flush();
            this.broadcast("error", new ErrorMessage("Server error detected: resetting round."))
        } else {
            throw new Error("INVALID TRANSITION: " + this.gameState + " --> " + nextState);
        }


        this.flush();
        //console.log("transitionState")
    }

    private reset() {
        this.gameState = Gamestate.Preround;

        for (let id of this.toDelete) {
            this.deletePlayer(id);
        }
        this.toDelete = [];

        this.state.player_map.forEach((player) => {
            player.currentBet = 0;
            player.isTurn = false;
            player.inRound = false;
            player.isReady = false;
            player.hand = [];
            player.bestHand = [];
            player.shouldShowHand = false;
            player.lastAction = "";
        })

        this.currentPlay = "";
        this.currentBet = 0;
        this.lastRaise = 0.5;
        this.state.pot = 0;
        this.state.board = new ArraySchema<Card>();
        this.state.running = false;
        this.deck = new Deck();
        this.state.winners = [];
        this.state.winningMessage = null;

        //console.log("reset")
    }

    private deletePlayer(id: string) {
        if (this.state.player_map.get(id) && this.state.player_map.get(id).isDealer) {
            let new_dealer_id = this.state.player_order[(this.state.player_order.indexOf(id) - 1 + this.state.player_order.length) % this.state.player_order.length];
            this.state.player_map.get(new_dealer_id).isDealer = true;
        }
        this.state.player_map.delete(id);
        for (let i = 0; i < this.state.player_order.length; i++) {
            if (this.state.player_order[i] == id) {
                this.state.player_order.splice(i, 1);
            }
        }

        //console.log("deletePlayer")
    }
  
    /*
    Folds a player, even if they aren't the current player (such as if they leave the game)
    */
    private fold(id: string) {
        let player = this.state.player_map.get(id);
        player.lastAction = FOLD;
        if(this.getCurrentPlayer().id == id) {
            this.incrementPlayerTurn(player, true); 
        } else {
            player.inRound = false;
        }

        if(this.numPlayersInRound() == 1) {
            this.transitionState(Gamestate.EndGame);
        } else {
            this.transitionIfNeeded();
            if (this.currentPlay == id) {
                // TODO: error handling when this.getNextPlayer(player) returns undefined
                this.currentPlay = this.getNextPlayer(player).id;
            }
        }

        //console.log("fold")
    }

    private raise(amount: number, player: Player) {
        this.lastRaise = amount - 1;
        
        this.currentBet = amount;

        player.bb -= amount - player.currentBet;
        this.state.pot += amount - player.currentBet;
        player.currentBet = amount;

        if(player.bb == 0) {
            player.lastAction = ALL_IN;
        } else {
            player.lastAction = RAISE;
        }

        this.incrementPlayerTurn(player)
        this.currentPlay = player.id;

        this.flush();
    }

    onCreate(options: any) {
        this.setState(new GameState());

        this.onMessage("ready", (client, message: ReadyState) => {
            if (this.state.player_map.has(client.id)) {
                this.state.player_map.get(client.id).isReady = message.isReady;
            }

            if (this.allPlayersReady() && this.state.player_order.length > 1) {
                this.transitionState(Gamestate.Preflop);
            }

            this.flush();
            //console.log("onMessage::ready")
        });

        this.onMessage("fold", (client, message) => {
            if(this.getCurrentPlayer().id == client.id) { // TODO: this can crash...
                this.fold(client.id);
                this.flush();
            } else {
                client.send("error", new ErrorMessage("Cannot fold until your turn."))
            }
            
            //console.log("onMessage::fold")
        });
        this.onMessage("call", (client, message) => {
            if(this.getCurrentPlayer().id == client.id) { // TODO: can also crash when current player doesn't exist?
                let player = this.state.player_map.get(client.id);
                player.lastAction = CALL;
                if(player.bb >= this.currentBet - player.currentBet) {
                    player.bb -= this.currentBet - player.currentBet;
                    this.state.pot += this.currentBet - player.currentBet;
                    player.currentBet = this.currentBet;
                } else {
                    this.state.pot += player.bb;
                    player.currentBet += player.bb;
                    player.bb = 0;
                }

                this.incrementPlayerTurn(player)
                this.transitionIfNeeded();

                this.flush();
            } else {
                client.send("error", new ErrorMessage("Cannot call until your turn."))
            }
            //console.log("onMessage::call")
        });
        this.onMessage("raise", (client, message: Raise) => {
            if(this.getCurrentPlayer().id == client.id) { // TODO: this can crash too?
                // Player must raise at least twice the last raise
                let requiredMessage = 1 + this.lastRaise * 2;
                let player = this.state.player_map.get(client.id);

                if(player.bb <= (requiredMessage - player.currentBet) && message.amount == (player.bb + player.currentBet)) {
                    // Player is all-ining: this is okay
                    this.raise(message.amount, player);
                } else if (message.amount < 1) {
                    console.log("Bet less than minimum. Bet must be at least " + requiredMessage)
                    client.send("error", new ErrorMessage("Bet must be at least " + requiredMessage))
                } else if (message.amount < requiredMessage) {
                    console.log("Must raise at least twice the last raise. Bet must be at least " + requiredMessage)
                    client.send("error", new ErrorMessage("Bet must be at least " + requiredMessage))
                } else if(message.amount > player.bb + player.currentBet) {
                    console.log("Player bet more chips than they have")
                    client.send("error", new ErrorMessage("Bet cannot be more than " + (player.bb +  player.currentBet)));
                } else {
                    this.raise(message.amount, player);
                }
            } else {
                client.send("error", new ErrorMessage("Cannot raise until your turn."))
            }

            //console.log("onMessage::raise")
        });

        //console.log("onCreate")
    }

    onJoin(client: Client, options: any) {
        //console.log("player joining!")
        let player = new Player(client.id, false);
        this.state.player_map.set(client.id, player);

        player.bb = 150;  // TODO: set this to the same as the small stack

        if (!this.state.running) {
            this.state.player_order.push(player.id);
        } else {
            for (let i = 0; i < this.state.player_order.length; i++) {
                if (this.state.player_map.get(this.state.player_order[i]).isDealer) {
                    // Splice doesn't insert the value on the ArraySchema (although the function exists and doesn't throw an error)
                    // so we create a temporary array instead
                    let t = Array.from(this.state.player_order);
                    t.splice(1, 0, player.id)
                    this.state.player_order = t;
                }
            }
            player.inRound = false;
        }

        this.flush();
        //console.log("onJoin")
    }

    // TODO: if everyone but the current player leaves the game doesn't instantly end
    onLeave(client: Client, consented: boolean) {
        // Reset the game if only one player will be left
        if (this.state.player_order.length == 2) {
            // Reset the game if we were in the end-game menu
            if (this.gameState == Gamestate.EndGame || this.gameState == Gamestate.Preround) {
                this.deletePlayer(client.id);
                this.reset(); 
                return;
            } else {
                this.toDelete.push(client.id);
                this.fold(client.id);
            }
        } else if (this.state.running && this.state.player_map.get(client.id).inRound) {
            this.toDelete.push(client.id);
            this.fold(client.id);
        } else {
            this.deletePlayer(client.id);
        }

        this.flush();
        //console.log("onLeave")
    }

    onDispose() {
    }

    // Sometimes the game isn't updating the state correctly 
    // after changes, so we need to manually broadcast them
    flush() {
        this.broadcastPatch();
        this.broadcast("state-update", this.state);
        //console.log("flush")
    }
}

/*
Feature list:
- if someone is all-in, don't give them any more turns
- if someone is all-in, and more players bet, make a new pot for that
- ensure someone can't bb / sb if it takes them to negative chips
- validate the raise inputs to ensure they are numbers
- add spectators when ppl run out of chips or the table is full
*/
