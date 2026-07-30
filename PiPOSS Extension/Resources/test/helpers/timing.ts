/** The two asynchronous barriers this suite is allowed to wait on. */

/**
 * One turn of the *timer* queue — a real barrier, not a microtask.
 *
 * The fake dispatches `storage.onChanged` synchronously inside `set` and Safari
 * dispatches after the write settles (DECISIONS 51), so an awaited write is not a
 * barrier for anything a listener computes. Waiting this makes a propagation assertion
 * hold under both orderings.
 */
export function macrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * One animation frame, then one macrotask.
 *
 * What anything waiting on the composition root's observer must wait for: its runs are
 * coalesced to one per animation frame (RRR §5.3), and a frame is a task the microtask
 * and timer-zero queues never reach. The trailing macrotask only orders this barrier
 * after a frame callback registered in the same frame as this one.
 */
export function frame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}
