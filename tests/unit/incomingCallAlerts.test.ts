/**
 * A ringing call alerts the player anywhere in Club Arena (Dan, 2026-10-31:
 * "ZERO NOTIFICATIONS ANYWHERE ELSE WHILE AN INCOMING CALL IS RINGING").
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  incomingCallAnswerPath,
  incomingCallFromRow,
  incomingCallMessage,
} from '../../src/components/common/IncomingCallAlertHost';

const row = {
  id: '6f1c2f2e-0000-4000-8000-000000000001',
  type: 'incoming_call',
  data: {
    roomName: 'sp-call-470b8556-b42a-4b0e-bdb4-5b566bff2f56-mvwvktsghsupun',
    callType: 'video',
    callerName: 'kingfish',
  },
};

describe('incoming call alerts', () => {
  it('reads the ringing call from its notification row', () => {
    expect(incomingCallFromRow(row)).toEqual({
      id: row.id,
      roomName: row.data.roomName,
      callerName: 'kingfish',
      callType: 'video',
    });
  });

  it('ignores other notifications and rows without a call room', () => {
    expect(incomingCallFromRow({ ...row, type: 'new_message' })).toBeNull();
    expect(incomingCallFromRow({ ...row, data: { roomName: 'javascript:alert(1)' } })).toBeNull();
    expect(incomingCallFromRow(null)).toBeNull();
  });

  it('answers in the World Hub, which auto-answers on arrival', () => {
    expect(incomingCallAnswerPath(row.data.roomName)).toBe(
      '/hub/messenger?incomingCall=sp-call-470b8556-b42a-4b0e-bdb4-5b566bff2f56-mvwvktsghsupun&answer=1'
    );
  });

  it('says who is calling in Title Case with no em dash', () => {
    const message = incomingCallMessage(incomingCallFromRow(row)!);
    expect(message).toBe('Incoming Video Call From kingfish. Tap To Answer');
    expect(message).not.toMatch(/—/);
  });

  it('is wired to the header channel and keeps live tables mounted', () => {
    const store = readFileSync('src/stores/useHeaderDataStore.ts', 'utf8');
    expect(store).toMatch(/row\?\.type === 'incoming_call'[\s\S]{0,120}INCOMING_CALL_EVENT/);
    expect(store).toMatch(/payload\?\.eventType === 'DELETE'[\s\S]{0,160}CALL_ALERT_CLEARED_EVENT/);
    const host = readFileSync('src/components/common/IncomingCallAlertHost.tsx', 'utf8');
    expect(host).toMatch(/if \(liveTablesOpen\(\)\) masterBus\.emit\('OPEN_HUB_TAB'/);
    expect(readFileSync('src/App.tsx', 'utf8')).toMatch(/<IncomingCallAlertHost \/>/);
  });
});
