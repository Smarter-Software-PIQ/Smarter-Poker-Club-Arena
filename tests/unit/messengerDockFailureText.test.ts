/**
 * "signal timed out" in red above the chat button on the poker table
 * (Dan 2026-11-18). A refresh nobody asked for printed the browser's own
 * abort text over the page. Pinned here: transport failures are said plainly,
 * and a background refresh reports inside the inbox, never over the page.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dockFailureText } from '../../src/components/messenger/dock/messengerDock.mjs';

const dock = readFileSync(
  resolve(__dirname, '../../src/components/messenger/dock/MessengerDock.jsx'),
  'utf8'
);

describe('what the dock says when a request fails', () => {
  it('never repeats the browser abort text', () => {
    const timeout = Object.assign(new Error('signal timed out'), { name: 'TimeoutError' });
    expect(dockFailureText(timeout)).toBe('Messages Are Taking Too Long. Try Again');
    expect(dockFailureText(new DOMException('The operation was aborted.', 'AbortError'))).toBe(
      'Messages Are Taking Too Long. Try Again'
    );
    expect(dockFailureText(new Error('The user aborted a request.'))).toBe(
      'Messages Are Taking Too Long. Try Again'
    );
  });

  it('says a dropped connection plainly', () => {
    for (const text of [
      'Failed to fetch',
      'Load failed',
      'NetworkError when attempting to fetch resource.',
    ]) {
      expect(dockFailureText(new TypeError(text))).toBe(
        'Messages Are Unavailable. Check Your Connection'
      );
    }
    expect(dockFailureText(undefined)).toBe('Messages Are Unavailable. Check Your Connection');
  });

  it('keeps a message the Messenger API wrote for a person', () => {
    expect(dockFailureText(new Error('Messenger Is Temporarily Unavailable'))).toBe(
      'Messenger Is Temporarily Unavailable'
    );
    expect(dockFailureText(new Error('Account Changed. Reopen This Conversation'))).toBe(
      'Account Changed. Reopen This Conversation'
    );
  });

  it('a background refresh reports inside the inbox, not over the page', () => {
    // The refresh writes to inboxError; only an explicit tap writes to error.
    expect(dock).toContain('setInboxError(dockFailureText(failure));');
    expect(dock).toContain('if (!incoming) setError(dockFailureText(failure));');
    expect(dock).not.toContain('setError(failure.message)');
    // The strip floated over the page reads `error` alone.
    expect(dock).toContain('{error && <p role="alert" className="dock-preview-error">{error}</p>}');
    // The open inbox shows either, with Retry.
    expect(dock).toContain('{(error || inboxError) && <div role="alert">');
  });
});
