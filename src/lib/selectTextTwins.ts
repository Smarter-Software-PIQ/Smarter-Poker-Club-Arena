/**
 * Ask a set-returning RPC for its money columns again as exact decimal text
 * (`*,amount_text:amount::text`), so a figure prints digit for digit instead
 * of passing through a JavaScript number (Dan 2026-11-13). A builder without a
 * column list (a non-PostgREST shim) is returned unchanged and its rows simply
 * carry no twins, so the display falls back to the number.
 */
export function selectTextTwins<T>(builder: T, columns: string): T {
  const select = (builder as { select?: (columns: string) => T } | null)?.select;
  return typeof select === 'function' ? select.call(builder, columns) : builder;
}
