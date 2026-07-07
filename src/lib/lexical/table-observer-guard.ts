import type { LexicalEditor } from "lexical";

/**
 * Resilience shim for `@lexical/table`'s `TableObserver` teardown race.
 *
 * `TableObserver.trackTable()` attaches a DOM `MutationObserver` to each table
 * element and re-reads the table node on every mutation via
 * `editor.read('latest', ...)` → `$getTableAndElementByKey`. That observer is
 * not disconnected when the table node is destroyed, so deleting (or rebuilding)
 * a table can fire one last mutation callback after the node is already gone.
 * The stale lookup then throws one of:
 *
 *   - `TableObserver: Expected tableNodeKey <k> to be a TableNode`
 *   - `TableObserver: Expected to find TableElement in DOM for key <k>`
 *
 * Both are benign: the table no longer exists, so the queued redraw has nothing
 * to do. `readEditorState` does not route thrown errors through the editor's
 * `onError`, so without this guard the invariant surfaces as an uncaught runtime
 * error. Until the upstream observer disconnects on teardown, we wrap the
 * editor's `read` to swallow exactly those invariants and rethrow everything
 * else.
 */
export function isBenignTableObserverError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("TableObserver: Expected")
  );
}

/**
 * Wraps `editor.read` so benign `TableObserver` teardown lookups are ignored.
 * Returns a disposer that restores the original method.
 */
export function installTableObserverReadGuard(
  editor: LexicalEditor,
): () => void {
  const originalRead = editor.read;
  const guardedRead = function guardedRead(
    this: LexicalEditor,
    ...args: unknown[]
  ): unknown {
    try {
      return (originalRead as (...a: unknown[]) => unknown).apply(this, args);
    } catch (error) {
      if (isBenignTableObserverError(error)) {
        return undefined;
      }
      throw error;
    }
  } as unknown as LexicalEditor["read"];

  editor.read = guardedRead;

  return () => {
    if (editor.read === guardedRead) {
      editor.read = originalRead;
    }
  };
}
