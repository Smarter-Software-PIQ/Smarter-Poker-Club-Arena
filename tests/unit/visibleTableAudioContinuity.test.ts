import { afterEach, expect, it, vi } from 'vitest';

let service: (typeof import('../../src/services/SoundService'))['soundService'] | undefined;
let hidden = false;
const suspend = vi.fn();
const oscillator = vi.fn();

async function playingTable() {
  vi.useFakeTimers();
  vi.resetModules();
  hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const node: any = new Proxy(function () {}, {
    get: (_target, key) => (key === 'value' ? 1 : node),
    set: () => true,
    apply: () => node,
  });
  class Context {
    state = 'running';
    currentTime = 0;
    sampleRate = 48000;
    destination = node;
    createGain() {
      return node;
    }
    createOscillator() {
      oscillator();
      return node;
    }
    createBuffer() {
      return { getChannelData: () => new Float32Array(1) };
    }
    suspend() {
      suspend();
      this.state = 'suspended';
      return Promise.resolve();
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    close() {
      this.state = 'closed';
      return Promise.resolve();
    }
    addEventListener() {}
    constructor() {
      return new Proxy(this, {
        get: (target, key) => (key in target ? (target as any)[key] : () => node),
      });
    }
  }
  vi.stubGlobal('AudioContext', Context);
  localStorage.clear();
  ({ soundService: service } = await import('../../src/services/SoundService'));
  service.setEnabled(true);
  service.playLevelUp();
  expect(oscillator).toHaveBeenCalled();
  return service;
}

afterEach(() => {
  service?.destroy();
  service = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

it('keeps visible table audio running through a quiet interval after a level increase', async () => {
  const sounds = await playingTable();
  await vi.advanceTimersByTimeAsync(21_000);
  expect(suspend).not.toHaveBeenCalled();
  expect(sounds.audioState()).toBe('running');
  oscillator.mockClear();
  sounds.playCheck();
  expect(oscillator).toHaveBeenCalled();
  expect(sounds.isEnabled()).toBe(true);
});

it('still suspends a hidden idle table without changing its sound preference', async () => {
  const sounds = await playingTable();
  hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(21_000);
  expect(suspend).toHaveBeenCalledOnce();
  expect(sounds.audioState()).toBe('suspended');
  expect(sounds.isEnabled()).toBe(true);
});

it('cancels background suspension when the player returns before the deadline', async () => {
  const sounds = await playingTable();
  hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(10_000);
  hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(21_000);
  expect(suspend).not.toHaveBeenCalled();
  expect(sounds.audioState()).toBe('running');
});
