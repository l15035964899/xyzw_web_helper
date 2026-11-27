/**
 * FIFO account locks shared by scheduled and manually triggered tasks.
 * A task acquires every selected account in stable order before it starts.
 */
export class TokenLockQueue {
  constructor() {
    this.holders = new Map();
    this.waiters = new Map();
    this.listeners = new Set();
  }

  isLocked(tokenId) {
    return this.holders.has(String(tokenId));
  }

  holder(tokenId) {
    return this.holders.get(String(tokenId)) || null;
  }

  snapshot() {
    return Object.fromEntries(
      [...this.holders.entries()].map(([tokenId, taskId]) => [tokenId, taskId]),
    );
  }

  waitingTaskIds(tokenId, { excludeTaskId = null } = {}) {
    return (this.waiters.get(String(tokenId)) || [])
      .map((entry) => entry.taskId)
      .filter((taskId) => taskId !== excludeTaskId);
  }

  hasWaitingTask(tokenId, options = {}) {
    return this.waitingTaskIds(tokenId, options).length > 0;
  }

  waitingSnapshot() {
    return Object.fromEntries(
      [...this.waiters.entries()]
        .filter(([, queue]) => queue.length > 0)
        .map(([tokenId, queue]) => [
          tokenId,
          queue.map((entry) => entry.taskId),
        ]),
    );
  }

  onAvailabilityChange(listener) {
    if (typeof listener !== "function") return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Acquire one account lock, waiting behind earlier requests when necessary.
   * @param {string} tokenId Account identity.
   * @param {string} taskId Task identity.
   * @param {object} options Queue notification callback.
   * @param {Function} options.onWait Called once when the request must wait.
   * @param {AbortSignal} [options.signal] Cancels a queued request.
   * @returns {Promise<void>} Resolves when this task owns the lock.
   */
  async acquire(tokenId, taskId, { onWait, signal } = {}) {
    const key = String(tokenId);
    if (signal?.aborted) throw errorFromAbortSignal(signal);
    if (!this.holders.has(key)) {
      this.holders.set(key, taskId);
      this._notifyAvailability();
      return;
    }

    onWait?.(this.holders.get(key));
    await new Promise((resolve, reject) => {
      const queue = this.waiters.get(key) || [];
      const entry = {
        taskId,
        resolve,
        reject: null,
        onAbort: null,
        signal: signal || null,
      };
      const onAbort = () => {
        const current = this.waiters.get(key) || [];
        const index = current.indexOf(entry);
        if (index < 0) return;
        current.splice(index, 1);
        if (current.length === 0) this.waiters.delete(key);
        this._notifyAvailability();
        reject(errorFromAbortSignal(signal));
      };
      entry.onAbort = onAbort;
      signal?.addEventListener?.("abort", onAbort, { once: true });
      queue.push(entry);
      this.waiters.set(key, queue);
      this._notifyAvailability();
    });
  }

  /**
   * Acquire all selected accounts in sorted order to prevent lock cycles.
   * @param {Iterable<string>} tokenIds Selected account identities.
   * @param {string} taskId Task identity.
   * @param {object} options Queue notification callback.
   * @param {Function} options.onWait Called when any account must wait.
   * @param {AbortSignal} [options.signal] Cancels queued acquisition.
   * @returns {Promise<{release:Function}>} Lease that releases every account.
   */
  async acquireAll(tokenIds, taskId, { onWait, signal } = {}) {
    const keys = [...new Set([...tokenIds].map(String))].sort();
    const acquired = [];
    try {
      for (const key of keys) {
        await this.acquire(key, taskId, { onWait, signal });
        acquired.push(key);
      }
    } catch (error) {
      for (const key of acquired.reverse()) this.release(key, taskId);
      throw error;
    }
    return {
      release: () => {
        for (const key of acquired.reverse()) this.release(key, taskId);
      },
    };
  }

  release(tokenId, taskId) {
    const key = String(tokenId);
    if (this.holders.get(key) !== taskId) return false;
    this.holders.delete(key);
    this._wakeNext(key);
    return true;
  }

  _wakeNext(tokenId) {
    const queue = this.waiters.get(tokenId);
    if (!queue?.length) {
      this.waiters.delete(tokenId);
      this._notifyAvailability();
      return;
    }
    const next = queue.shift();
    if (!queue.length) this.waiters.delete(tokenId);
    this.holders.set(tokenId, next.taskId);
    next.signal?.removeEventListener?.("abort", next.onAbort);
    this._notifyAvailability();
    next.resolve();
  }

  _notifyAvailability() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Observers must not interrupt FIFO lock hand-off.
      }
    }
  }
}

function errorFromAbortSignal(signal) {
  const reason = signal?.reason;
  const error = new Error(
    typeof reason === "string"
      ? reason
      : typeof reason?.code === "string"
        ? String(reason.message || reason)
        : "账号锁等待已取消",
  );
  error.name = "AbortError";
  error.code = "LOCK_ABORTED";
  return error;
}
