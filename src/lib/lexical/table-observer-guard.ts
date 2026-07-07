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
 *
 * Because the leaked `MutationObserver` keeps a reference to the editor it was
 * created with, the guard must outlive the plugin that installs it — otherwise a
 * stale observer would fire against an editor whose `read` was already restored
 * (common under React StrictMode / Turbopack Fast Refresh remounts). The guard
 * is therefore installed permanently and idempotently for the editor's lifetime.
 */
export function isBenignTableObserverError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("TableObserver: Expected")
  );
}

/**
 * Editors whose `read` has already been wrapped, so repeated installs (React
 * StrictMode double-invokes, Fast Refresh re-runs) never stack wrappers.
 */
const guardedEditors = new WeakSet<LexicalEditor>();

/**
 * Wraps `editor.read` so benign `TableObserver` teardown lookups are ignored.
 * Idempotent per editor instance. Returns a disposer that restores the original
 * method; callers that want the guard to outlive a leaked `MutationObserver`
 * (see module comment) should simply not call it.
 */
export function installTableObserverReadGuard(
  editor: LexicalEditor,
): () => void {
  if (guardedEditors.has(editor)) {
    return () => {};
  }

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
  guardedEditors.add(editor);

  return () => {
    if (editor.read === guardedRead) {
      editor.read = originalRead;
    }
    guardedEditors.delete(editor);
  };
}
