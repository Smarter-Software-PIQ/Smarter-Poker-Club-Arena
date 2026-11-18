/** Keep a useful failure signature without request credentials or body dumps. */
export function redactedConsoleFailure(text: string): string {
  return text
    .split('\n', 1)[0]
    .replace(/\beyJ[\w.-]+/g, '[token]')
    .replace(/\bsb_(?:secret|publishable)_[\w-]+/g, '[key]')
    .replace(/\b(?:authorization|bearer|apikey|password|cookie)\b.*$/i, '[redacted]')
    .replace(/https?:\/\/\S+/g, '[url]')
    .slice(0, 800);
}
