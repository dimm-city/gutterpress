/**
 * A host call's outcome as plain data, for calls whose failures the renderer
 * needs in full.
 *
 * When an `ipcMain.handle` listener rejects, Electron hands the renderer a new
 * Error holding only the original's message, prefixed "Error invoking remote
 * method …": the `code` is gone. Custom properties are dropped again at the
 * preload's context bridge. So a failure is returned as data (`toIpcResult` in
 * the main process) and turned back into an Error with its code in the
 * renderer's adapter (`fromIpcResult`), with its `detail` (the original text
 * behind a plain sentence) when it has one.
 */
export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string; code?: string; detail?: string } };

export async function toIpcResult<T>(work: Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await work };
  } catch (e) {
    const { code, detail } = (e ?? {}) as { code?: unknown; detail?: unknown };
    return {
      ok: false,
      error: {
        message: e instanceof Error ? e.message : String(e),
        ...(typeof code === "string" ? { code } : {}),
        ...(typeof detail === "string" ? { detail } : {}),
      },
    };
  }
}

/** The value, or the failure rethrown as an Error carrying its `code` and `detail`. */
export function fromIpcResult<T>(result: IpcResult<T>): T {
  if (result.ok) return result.value;
  const { message, code, detail } = result.error;
  throw Object.assign(new Error(message), code ? { code } : {}, detail ? { detail } : {});
}
