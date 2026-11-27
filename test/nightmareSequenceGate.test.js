import assert from "node:assert/strict";
import test from "node:test";
import { NightmareSequenceGate } from "../render-backend/lib/nightmareSequenceGate.js";

test("nightmare gate waits scheduled tasks and deduplicates repeated triggers", async () => {
  const gate = new NightmareSequenceGate();
  const lease = await gate.acquire("nightmare-task");
  const waits = [];

  const first = gate.wait("hangup", {
    onWait: (ownerTaskId) => waits.push(ownerTaskId),
  });
  const duplicate = await gate.wait("hangup");
  const second = gate.wait("tower");

  assert.deepEqual(duplicate, { shouldRun: false, waited: true });
  assert.equal(gate.snapshot().waitingTaskIds.length, 2);

  lease.release();
  assert.deepEqual(await first, { shouldRun: true, waited: true });
  assert.deepEqual(await second, { shouldRun: true, waited: true });
  assert.deepEqual(waits, ["nightmare-task"]);
  assert.equal(gate.isActive(), false);
});

test("nightmare gate can stay held for manual cleanup and be released explicitly", async () => {
  const gate = new NightmareSequenceGate();
  const lease = gate.restore("sequence-task");
  lease.hold();
  assert.equal(gate.isActive(), true);
  assert.equal(gate.releaseOwner("sequence-task"), true);
  assert.equal(gate.isActive(), false);
  assert.equal(lease.release(), false);
});

test("the same nightmare owner can reacquire an active gate after restart recovery", async () => {
  const gate = new NightmareSequenceGate();
  const first = gate.restore("sequence-task");
  const resumed = await gate.acquire("sequence-task");
  assert.equal(resumed.ownerTaskId, "sequence-task");
  resumed.release();
  assert.equal(gate.isActive(), false);
  assert.equal(first.release(), false);
});
