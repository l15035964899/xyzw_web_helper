import assert from "node:assert/strict";
import test from "node:test";
import { TokenLockQueue } from "../render-backend/lib/tokenLockQueue.js";

test("overlapping tasks queue until the previous task releases every account", async () => {
  const locks = new TokenLockQueue();
  const first = await locks.acquireAll(["account-b", "account-a"], "task-a");
  let secondStarted = false;
  let waitedFor = "";
  const secondPromise = locks
    .acquireAll(["account-a", "account-c"], "task-b", {
      onWait: (holder) => {
        waitedFor = holder;
      },
    })
    .then((lease) => {
      secondStarted = true;
      return lease;
    });

  await Promise.resolve();
  assert.equal(secondStarted, false);
  assert.equal(waitedFor, "task-a");

  first.release();
  const second = await secondPromise;
  assert.equal(secondStarted, true);
  assert.equal(locks.holder("account-a"), "task-b");
  assert.equal(locks.holder("account-c"), "task-b");
  second.release();
  assert.equal(locks.isLocked("account-a"), false);
});

test("waiting tasks are granted the lock in FIFO order", async () => {
  const locks = new TokenLockQueue();
  const order = [];
  await locks.acquire("account-a", "running");
  const second = locks.acquire("account-a", "second").then(() => {
    order.push("second");
  });
  const third = locks.acquire("account-a", "third").then(() => {
    order.push("third");
  });

  locks.release("account-a", "running");
  await second;
  locks.release("account-a", "second");
  await third;
  locks.release("account-a", "third");

  assert.deepEqual(order, ["second", "third"]);
});

test("disjoint account sets do not wait for each other", async () => {
  const locks = new TokenLockQueue();
  const first = await locks.acquireAll(["account-a"], "task-a");
  const second = await locks.acquireAll(["account-b"], "task-b");
  assert.equal(locks.holder("account-a"), "task-a");
  assert.equal(locks.holder("account-b"), "task-b");
  first.release();
  second.release();
});
