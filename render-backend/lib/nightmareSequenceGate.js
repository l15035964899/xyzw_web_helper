/**
 * Global gate used while a nightmare sequence or manual challenge is active.
 * Scheduled tasks wait behind the gate and only one occurrence per task is
 * retained for catch-up after the gate opens.
 */
export class NightmareSequenceGate {
  constructor() {
    this.activeGate = null;
    this.waitingTasks = new Set();
  }

  snapshot() {
    return this.activeGate
      ? {
          ownerTaskId: this.activeGate.ownerTaskId,
          waitingTaskIds: [...this.waitingTasks],
        }
      : { ownerTaskId: null, waitingTaskIds: [] };
  }

  isActive() {
    return Boolean(this.activeGate);
  }

  restore(ownerTaskId) {
    if (this.activeGate?.ownerTaskId === String(ownerTaskId)) {
      return this._lease(this.activeGate);
    }
    if (this.activeGate) {
      throw new Error(
        `十殿调度闸门已被任务 ${this.activeGate.ownerTaskId} 占用`,
      );
    }
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    this.activeGate = {
      ownerTaskId: String(ownerTaskId),
      promise,
      resolve,
    };
    return this._lease(this.activeGate);
  }

  async acquire(ownerTaskId) {
    const ownerId = String(ownerTaskId);
    while (this.activeGate && this.activeGate.ownerTaskId !== ownerId) {
      await this.activeGate.promise;
    }
    if (this.activeGate?.ownerTaskId === ownerId) {
      return this._lease(this.activeGate);
    }
    return this.restore(ownerId);
  }

  async wait(taskId, { onWait } = {}) {
    const key = String(taskId);
    if (!this.activeGate) return { shouldRun: true, waited: false };
    if (this.waitingTasks.has(key)) {
      return { shouldRun: false, waited: true };
    }

    this.waitingTasks.add(key);
    let waited = false;
    try {
      while (this.activeGate) {
        if (!waited) onWait?.(this.activeGate.ownerTaskId);
        waited = true;
        const gate = this.activeGate;
        await gate.promise;
      }
      return { shouldRun: true, waited };
    } finally {
      this.waitingTasks.delete(key);
    }
  }

  releaseOwner(ownerTaskId) {
    const ownerId = String(ownerTaskId);
    if (this.activeGate?.ownerTaskId !== ownerId) return false;
    const gate = this.activeGate;
    this.activeGate = null;
    gate.resolve();
    return true;
  }

  _lease(gate) {
    let finished = false;
    return {
      ownerTaskId: gate.ownerTaskId,
      hold: () => {
        finished = true;
      },
      release: () => {
        if (finished) return false;
        finished = true;
        if (this.activeGate !== gate) return false;
        this.activeGate = null;
        gate.resolve();
        return true;
      },
    };
  }
}
