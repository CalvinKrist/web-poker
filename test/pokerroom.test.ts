import { ColyseusTestServer, boot } from "@colyseus/testing";
import {gameServer} from "../backend/serverConfig";
import {PokerRoom} from "../backend/PokerRoom";
import { READY } from "../messages/readystate";
import {Gamestate} from "../backend/PokerRoom";

console.warn = function() {}

describe("testing your Colyseus app", () => {
    let colyseus: ColyseusTestServer;
  
    beforeAll(async () => colyseus = await boot(gameServer));
    afterAll(async () => await colyseus.shutdown());
  
    beforeEach(async () => await colyseus.cleanup());
  
    it("server starts in Preround state", async() => {
      const room = await colyseus.createRoom("poker", {}) as PokerRoom;
  
      expect(room.gameState).toEqual(Gamestate.Preround);
    });

    it("clients can connect and remove in Preflop state", async() => {
      const room = await colyseus.createRoom("poker", {}) as PokerRoom;
  
      let client1 = await colyseus.connectTo(room);
      expect(room.state.player_map.has(client1.sessionId)).toBeTruthy();

      const client2 = await colyseus.connectTo(room);
      expect(room.state.player_map.has(client2.sessionId)).toBeTruthy();

      client1.leave();
      await room.waitForNextPatch();
      
      expect(room.state.player_map.has(client1.sessionId)).toBeFalsy();

      client1 = await colyseus.connectTo(room);
      expect(room.state.player_map.has(client1.sessionId)).toBeTruthy();
    });

    it("clients can connect and remove in Endgame state", async() => {
      const room = await colyseus.createRoom("poker", {}) as PokerRoom;
      room.gameState = Gamestate.EndGame;
  
      let client1 = await colyseus.connectTo(room);
      expect(room.state.player_map.has(client1.sessionId)).toBeTruthy();

      const client2 = await colyseus.connectTo(room);
      expect(room.state.player_map.has(client2.sessionId)).toBeTruthy();

      client1.leave();
      await room.waitForNextPatch();
      
      expect(room.state.player_map.has(client1.sessionId)).toBeFalsy();

      client1 = await colyseus.connectTo(room);
      expect(room.state.player_map.has(client1.sessionId)).toBeTruthy();
    });

    it("when every player readys up the game starts", async() => {
      const num_client_cases = [2, 3, 6];
      for(let num_clients of num_client_cases) {

        const room = await colyseus.createRoom("poker", {}) as PokerRoom;
        let clients = [];
        for(let i = 0; i < num_clients; i++) {
          expect(room.gameState).toEqual(Gamestate.Preround);
          clients.push(await colyseus.connectTo(room));
        }
        expect(room.gameState).toEqual(Gamestate.Preround);

        for(let client of clients) {
          expect(room.gameState).toEqual(Gamestate.Preround);
          client.send("ready", READY);
          const [ c, message ] = await room.waitForMessage("ready");
        }

        expect(room.gameState).toEqual(Gamestate.Preflop);
      }
    });

    it("2/3 players: when the round starts, player 0 is the dealer and has the turn", async() => {
      let num_client_cases = [2, 3];
      for(let num_clients of num_client_cases) {        
        const room = await colyseus.createRoom("poker", {}) as PokerRoom;
        let clients = [];
        for(let i = 0; i < num_clients; i++) {
          clients.push(await colyseus.connectTo(room));
        }

        for(let client of clients) {
          client.send("ready", READY);
          const [ c, message ] = await room.waitForMessage("ready");
        }

        expect(room.state.player_map.get(clients[0].sessionId).isTurn).toBeTruthy();
        expect(room.state.player_map.get(clients[0].sessionId).isDealer).toBeTruthy();
      }
    });

    it("when the round starts, player 0 is the dealer and does not have the turn", async() => {
      let num_clients = 4;
      
      const room = await colyseus.createRoom("poker", {}) as PokerRoom;
      let clients = [];
      for(let i = 0; i < num_clients; i++) {
        clients.push(await colyseus.connectTo(room));
      }

      for(let client of clients) {
        client.send("ready", READY);
        const [ c, message ] = await room.waitForMessage("ready");
      }

      expect(room.state.player_map.get(clients[0].sessionId).isDealer).toBeTruthy();
      expect(room.state.player_map.get(clients[0].sessionId).isTurn).toBeFalsy();
    });

    it("when a player folds they leave the round and their turn ends", async() => {
      let num_client_cases = [2];
      for(let num_clients of num_client_cases) {        
        const room = await colyseus.createRoom("poker", {}) as PokerRoom;
        let clients = [];
        for(let i = 0; i < num_clients; i++) {
          clients.push(await colyseus.connectTo(room));
        }

        for(let client of clients) {
          client.send("ready", READY);
          const [ c, message ] = await room.waitForMessage("ready");
        }

        clients[0].send("fold", {});
        const [ c, message ] = await room.waitForMessage("fold");

        expect(room.state.player_map.get(clients[0].sessionId).isTurn).toBeFalsy();
        expect(room.state.player_map.get(clients[0].sessionId).inRound).toBeFalsy();
      }
    });

    it("when a player folds play moves to the next player", async() => {
      let num_clients = 4;
      const room = await colyseus.createRoom("poker", {}) as PokerRoom;
      let clients = [];
      for(let i = 0; i < num_clients; i++) {
        clients.push(await colyseus.connectTo(room));
      }

      for(let client of clients) {
        client.send("ready", READY);
        const [ c, message ] = await room.waitForMessage("ready");
      }

      expect(room.state.player_map.get(clients[3].sessionId).isTurn).toBeTruthy();

      clients[3].send("fold", {});
      let [ c, message ] = await room.waitForMessage("fold");

      expect(room.state.player_map.get(clients[3].sessionId).isTurn).toBeFalsy();
      expect(room.state.player_map.get(clients[3].sessionId).inRound).toBeFalsy();
      expect(room.state.player_map.get(clients[0].sessionId).isTurn).toBeTruthy();   
    });

    it("when a player folds and the next player is skipped, play moves to the next player still", async() => {
      let num_clients = 4;
      const room = await colyseus.createRoom("poker", {}) as PokerRoom;
      let clients = [];
      for(let i = 0; i < num_clients; i++) {
        clients.push(await colyseus.connectTo(room));
      }

      for(let client of clients) {
        client.send("ready", READY);
        const [ c, message ] = await room.waitForMessage("ready");
      }

      room.state.player_map.get(clients[0].sessionId).inRound = false;

      clients[3].send("fold", {});
      let [ c, message ] = await room.waitForMessage("fold");

      expect(room.state.player_map.get(clients[3].sessionId).isTurn).toBeFalsy();
      expect(room.state.player_map.get(clients[3].sessionId).inRound).toBeFalsy();
      expect(room.state.player_map.get(clients[0].sessionId).isTurn).toBeFalsy();
      expect(room.state.player_map.get(clients[1].sessionId).isTurn).toBeTruthy();
    });

    it("when a new round ends and everyone readys up, we start a new round", async() => {
      let num_clients = 3;
      
      const room = await colyseus.createRoom("poker", {}) as PokerRoom;
      let clients = [];
      for(let i = 0; i < num_clients; i++) {
        clients.push(await colyseus.connectTo(room));
      }

      for(let client of clients) {
        client.send("ready", READY);
        const [ c, message ] = await room.waitForMessage("ready");
      }

      clients[0].send("fold", {});
      let [ c, message ] = await room.waitForMessage("fold");
      clients[1].send("fold", {});
      [ c, message ] = await room.waitForMessage("fold");

      expect(room.gameState).toEqual(Gamestate.EndGame);

      for(let client of clients) {
        client.send("ready", READY);
        const [ c, message ] = await room.waitForMessage("ready");
      }

      expect(room.gameState).toEqual(Gamestate.Preflop);
    });

    it("when a new round starts, the dealer position moves", async() => {
      let num_clients = 3;
      
      const room = await colyseus.createRoom("poker", {}) as PokerRoom;
      let clients = [];
      for(let i = 0; i < num_clients; i++) {
        clients.push(await colyseus.connectTo(room));
      }

      for(let client of clients) {
        client.send("ready", READY);
        const [ c, message ] = await room.waitForMessage("ready");
      }

      expect(room.state.player_map.get(clients[0].sessionId).isDealer).toBeTruthy();

      clients[0].send("fold", {});
      let [ c, message ] = await room.waitForMessage("fold");
      clients[1].send("fold", {});
      [ c, message ] = await room.waitForMessage("fold");

      for(let client of clients) {
        client.send("ready", READY);
        const [ c, message ] = await room.waitForMessage("ready");
      }

      expect(room.state.player_map.get(clients[0].sessionId).isDealer).toBeFalsy();
      expect(room.state.player_map.get(clients[1].sessionId).isDealer).toBeTruthy();
    });

    it("when a new round starts and a player folds, play moves to the next player", async() => {
      let num_clients = 3;
      
      const room = await colyseus.createRoom("poker", {}) as PokerRoom;
      let clients = [];
      for(let i = 0; i < num_clients; i++) {
        clients.push(await colyseus.connectTo(room));
      }

      for(let client of clients) {
        client.send("ready", READY);
        const [ c, message ] = await room.waitForMessage("ready");
      }

      clients[0].send("fold", {});
      let [ c, message ] = await room.waitForMessage("fold");
      clients[1].send("fold", {});
      [ c, message ] = await room.waitForMessage("fold");

      for(let client of clients) {
        client.send("ready", READY);
        const [ c, message ] = await room.waitForMessage("ready");
      }

      expect(room.state.player_map.get(clients[1].sessionId).isTurn).toBeTruthy();

      clients[1].send("fold", {});
      [ c, message ] = await room.waitForMessage("fold");

      expect(room.state.player_map.get(clients[1].sessionId).isTurn).toBeFalsy();
      expect(room.state.player_map.get(clients[1].sessionId).inRound).toBeFalsy();
      expect(room.state.player_map.get(clients[2].sessionId).isTurn).toBeTruthy();
    });
  });
