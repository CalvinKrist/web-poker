import {ArraySchema, MapSchema, Schema, type} from "@colyseus/schema";
import {Player} from "./Player";
import {Deck} from "./Deck";

export class GameState extends Schema {
    @type({ map: Player })
    player_map: MapSchema<Player>;

    @type(["string"])
    player_order: string[];

    @type(Deck)
    deck: Deck;

    @type("boolean")
    running: boolean;

    @type("number")
    pot: number;

    constructor() {
        super();
        this.deck = new Deck();
        this.player_map = new MapSchema<Player>();
        this.running = false;
        this.player_order = new ArraySchema<string>();
        this.pot = 0;
    }

}
