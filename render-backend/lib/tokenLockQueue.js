/**
 * FIFO account locks shared by scheduled and manually triggered tasks.
 * A task acquires every selected account in stable order before it starts.
 */
export class TokenLockQueue {
  constructor() {
    this.holders = new Map();
    this.waiters = new Map();
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

  /**
   * Acquire one account lock, waiting behind earlier requests when necessary.
   * @param {string} tokenId Account identity.
   * @param {string} taskId Task identity.
   * @param {object} options Queue notification callback.
   * @param {Function} options.onWait Called once when the request must wait.
   * @returns {Promise<void>} Resolves when this task owns the lock.
   */
  async acquire(tokenId, taskId, { onWait } = {}) {
    const key = String(tokenId);
    if (!this.holders.has(key)) {
      this.holders.set(key, taskId);
      return;
    }

    onWait?.(this.holders.get(key));
    await new Promise((resolve) => {
      const queue = this.waiters.get(key) || [];
      queue.push({ taskId, resolve });
      this.waiters.set(key, queue);
    });
  }

  /**
   * Acquire all selected accounts in sorted order to prevent lock cycles.
   * @param {Iterable<string>} tokenIds Selected account identities.
   * @param {string} taskId Task identity.
   * @param {object} options Queue notification callback.
   * @param {Function} options.onWait Called when any account must wait.
   * @returns {Promise<{release:Function}>} Lease that releases every account.
   */
  async acquireAll(tokenIds, taskId, { onWait } = {}) {
    const keys = [...new Set([...tokenIds].map(String))].sort();
    const acquired = [];
    for (const key of keys) {
      await this.acquire(key, taskId, { onWait });
      acquired.push(key);
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
      return;
    }
    const next = queue.shift();
    if (!queue.length) this.waiters.delete(tokenId);
    this.holders.set(tokenId, next.taskId);
    next.resolve();
  }
}
