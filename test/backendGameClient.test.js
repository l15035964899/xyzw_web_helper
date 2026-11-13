import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/loadModule.js";

test("backend connection logs omit credential queries and early close clears the timeout", async () => {
  const timers = new Map();
  let timerId = 0;
  class Socket {
    constructor() {
      this.handlers = {};
    }
    on(event, handler) {
      this.handlers[event] = handler;
    }
    close() {}
  }
  const { GameClient } = await loadModule(
    new URL("../render-backend/lib/gameClient.js", import.meta.url),
    {
      "./bonProtocol.js": {},
      ws: { default: Socket },
    },
    {
      setTimeout(callback) {
        const id = ++timerId;
        timers.set(id, callback);
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
  );
  const client = new GameClient({ roleToken: "secret-test-token", roleId: 1 });
  const logs = [];
  client.log = (...args) => logs.push(args);
  const connection = client.connect();
  const rejected = assert.rejects(connection, /连接在建立前已关闭/);
  client.ws.handlers.close(1006, "closed");
  await rejected;
  assert.equal(timers.size, 0);
  assert.equal(JSON.stringify(logs).includes("secret-test-token"), false);
  assert.equal(logs[0][1], "wss://xxz-xyzw.hortorgames.com/agent");
});

test("battle commands fetch the current battle version and inject it once", async () => {
  const { GameClient } = await loadModule(
    new URL("../render-backend/lib/gameClient.js", import.meta.url),
    {
      "./bonProtocol.js": {},
      ws: { default: class Socket {} },
    },
  );
  const client = new GameClient({ roleToken: "secret-test-token", roleId: 1 });
  const calls = [];
  client._sendWithPromise = async (cmd, params = {}) => {
    calls.push({ cmd, params });
    if (cmd === "fight_startlevel") {
      return { battleData: { version: 240999 } };
    }
    return { ok: true };
  };

  await client.sendWithPromise("arena_startarea");
  await client.sendWithPromise("fight_startareaarena", { targetId: 9001 });
  await client.sendWithPromise("fight_startareaarena", { targetId: 9002 });

  assert.deepEqual(
    calls.map(({ cmd }) => cmd),
    [
      "arena_startarea",
      "fight_startlevel",
      "fight_startareaarena",
      "fight_startareaarena",
    ],
  );
  assert.equal(calls[2].params.battleVersion, 240999);
  assert.equal(calls[2].params.targetId, 9001);
  assert.equal(calls[3].params.battleVersion, 240999);
  assert.equal(calls[3].params.targetId, 9002);
});

test("card claims include the browser-compatible default card id", async () => {
  const sent = [];
  class Socket {
    static OPEN = 1;
    readyState = Socket.OPEN;
    send(raw) {
      sent.push(raw);
    }
  }
  const { GameClient } = await loadModule(
    new URL("../render-backend/lib/gameClient.js", import.meta.url),
    {
      "./bonProtocol.js": {
        bon: { encode: (value) => value },
        encode: (value) => value,
        getEnc: () => "x",
      },
      ws: { default: Socket },
    },
  );
  const client = new GameClient({ roleToken: "secret-test-token", roleId: 1 });
  client.connected = true;
  client.ws = new Socket();
  const release = (seq) => {
    const pending = client.promises[seq];
    clearTimeout(pending.timer);
    delete client.promises[seq];
    pending.resolve({ ok: true });
  };

  const defaultClaim = client.sendWithPromise("card_claimreward", {}, 1000);
  assert.equal(JSON.stringify(sent[0].body), JSON.stringify({ cardId: 1 }));
  release(1);
  await defaultClaim;

  const permanentCardClaim = client.sendWithPromise(
    "card_claimreward",
    { cardId: 4003 },
    1000,
  );
  assert.equal(JSON.stringify(sent[1].body), JSON.stringify({ cardId: 4003 }));
  release(2);
  await permanentCardClaim;
});
