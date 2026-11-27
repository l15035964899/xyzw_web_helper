function nowIso(now) {
  return (typeof now === "function" ? now() : new Date()).toISOString();
}

export function createNightmareSequenceState({
  taskId,
  teams,
  arenaFormations = {},
  startedAt = new Date(),
} = {}) {
  const timestamp = startedAt.toISOString();
  return {
    taskId: String(taskId),
    mode: "sequence",
    phase: "running",
    startedAt: timestamp,
    updatedAt: timestamp,
    resumeAt: null,
    teamSnapshots: teams.map((team) => ({ ...team })),
    teams: Object.fromEntries(
      teams.map((team, index) => [
        String(team.id),
        {
          id: String(team.id),
          name: team.name,
          order: index,
          crossWeek: Boolean(team.crossWeek),
          status: "pending",
          success: null,
          error: null,
          challengeState: null,
        },
      ]),
    ),
    arenaFormations: { ...arenaFormations },
  };
}

export function getNightmareSequenceGroups(state) {
  const snapshots = Array.isArray(state?.teamSnapshots)
    ? state.teamSnapshots
    : [];
  return {
    crossWeek: snapshots.filter(
      (team) =>
        team.crossWeek &&
        state.teams?.[String(team.id)]?.status !== "completed",
    ),
    sequential: snapshots.filter(
      (team) =>
        !team.crossWeek &&
        state.teams?.[String(team.id)]?.status !== "completed",
    ),
  };
}

export class NightmareSequenceStateStore {
  constructor({ taskId, state, saveState }) {
    this.taskId = String(taskId);
    this.state = state;
    this.saveState = saveState;
    this.pending = Promise.resolve();
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  update(mutator, { now = () => new Date() } = {}) {
    this.pending = this.pending.then(async () => {
      const next = this.snapshot();
      await mutator(next);
      next.taskId = this.taskId;
      next.updatedAt = nowIso(now);
      this.state = next;
      await this.saveState(this.snapshot());
      return this.snapshot();
    });
    return this.pending;
  }

  setPhase(phase, patch = {}) {
    return this.update((state) => {
      state.phase = phase;
      Object.assign(state, patch);
    });
  }

  updateTeam(teamId, patch = {}) {
    return this.update((state) => {
      const key = String(teamId);
      state.teams[key] = {
        ...(state.teams[key] || { id: key }),
        ...patch,
      };
    });
  }
}
