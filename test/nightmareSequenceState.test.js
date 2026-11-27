import assert from "node:assert/strict";
import test from "node:test";
import {
  createNightmareSequenceState,
  getNightmareSequenceGroups,
  NightmareSequenceStateStore,
} from "../render-backend/lib/nightmareSequenceState.js";
import { buildNightmareSequencePlan } from "../render-backend/lib/nightmareSettings.js";

function team(id, members, crossWeek = true, enabled = true) {
  return {
    id,
    name: id,
    enabled,
    leaderTokenId: members[0],
    mainTokenId: members[0],
    members: members.map((tokenId) => ({ tokenId, formation: 1 })),
    stages: [1, 2, 3, 4, 5, 6, 7, 8].map((layer) => ({
      layer,
      order: members,
    })),
    maxAttempts: 1,
    crossWeek,
  };
}

test("cross-week teams require pairwise disjoint members", () => {
  const source = [
    team("a", ["main", "a1"]),
    team("b", ["b1", "a1"]),
    team("c", ["main", "c1"]),
  ];
  const { teams, plan } = buildNightmareSequencePlan(source);

  assert.equal(plan[0].crossWeek, true);
  assert.equal(plan[0].crossWeekLocked, true);
  assert.equal(plan[1].crossWeek, false);
  assert.equal(plan[1].crossWeekLocked, true);
  assert.deepEqual(plan[1].conflictTeamIds, ["a"]);
  assert.equal(teams[1].crossWeek, false);

  const alternative = buildNightmareSequencePlan([
    team("a", ["main", "a1"]),
    team("b", ["b1", "b2"]),
    team("c", ["b1", "c1"]),
  ]);
  assert.equal(alternative.plan[1].crossWeek, true);
  assert.equal(alternative.plan[2].crossWeek, false);
  assert.deepEqual(alternative.plan[2].conflictTeamIds, ["b"]);
});

test("disabled teams are skipped before choosing the cross-week anchor", () => {
  const options = buildNightmareSequencePlan([
    team("a", ["a1", "a2"], true, false),
    team("b", ["b1", "b2"]),
    team("c", ["c1", "c2"], false),
  ]);
  assert.equal(options.plan[0].enabled, false);
  assert.equal(options.plan[1].crossWeek, true);
  assert.equal(options.plan[1].crossWeekLocked, true);
  assert.equal(options.plan[2].crossWeek, false);
  assert.equal(options.plan[2].crossWeekLocked, false);
});

test("a disabled team that shares the active cross-week team is also locked off", () => {
  const options = buildNightmareSequencePlan([
    team("a", ["main", "a1"]),
    team("b", ["main", "b1"], true, false),
  ]);

  assert.equal(options.plan[1].enabled, false);
  assert.equal(options.plan[1].crossWeek, false);
  assert.equal(options.plan[1].crossWeekLocked, true);
  assert.deepEqual(options.plan[1].conflictTeamIds, ["a"]);
  assert.equal(options.teams[1].crossWeek, false);
});

test("sequence state partitions parallel cross-week and sequential teams", () => {
  const state = createNightmareSequenceState({
    taskId: "task-a",
    teams: [team("a", ["a"]), team("b", ["b"], false)],
  });
  assert.deepEqual(
    getNightmareSequenceGroups(state).crossWeek.map(({ id }) => id),
    ["a"],
  );
  assert.deepEqual(
    getNightmareSequenceGroups(state).sequential.map(({ id }) => id),
    ["b"],
  );
  state.teams.a.status = "completed";
  assert.equal(getNightmareSequenceGroups(state).crossWeek.length, 0);
});

test("sequence state updates are serialized and persisted", async () => {
  const saved = [];
  const initialState = createNightmareSequenceState({
    taskId: "task-a",
    teams: [team("a", ["a"])],
  });
  const store = new NightmareSequenceStateStore({
    taskId: "task-a",
    state: initialState,
    saveState: async (state) => {
      saved.push(state);
    },
  });
  await Promise.all([
    store.updateTeam("a", { status: "running" }),
    store.updateTeam("a", { challengeState: { layer: 2 } }),
  ]);
  assert.equal(saved.length, 2);
  assert.equal(store.snapshot().teams.a.status, "running");
  assert.equal(store.snapshot().teams.a.challengeState.layer, 2);
});
