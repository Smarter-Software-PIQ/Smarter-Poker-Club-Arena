import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const readSrc = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('Club Arena Realtime Connectors & Lifecycle Hardening', () => {
  it('MessengerDock and MessengerChat isolate per-instance channel topics and guard shared typing teardown', () => {
    const dock = readSrc('src/components/messenger/dock/MessengerDock.jsx');
    expect(dock).toContain('messenger-dock:${actorId}:${instanceSuffix}');

    const chat = readSrc('src/components/messenger/dock/MessengerChat.jsx');
    expect(chat).toContain('dock-conversation:${actorId}:${id}:${instanceSuffix}');
    expect(chat).toContain('liveWasJoined');
    expect(chat).toContain("window.addEventListener('focus', returned)");
  });

  it('TournamentTimerService caches broadcastChannel per timer so level_up broadcasts do not leak refcounts', () => {
    const timerSvc = readSrc('src/services/TournamentTimerService.ts');
    expect(timerSvc).toContain(
      'broadcastChannel?: ReturnType<typeof masterBus.getOrCreateChannel>'
    );
    expect(timerSvc).toContain(
      'masterBus.removeRegisteredChannel(`tournament:${tournamentId}`, timer.broadcastChannel)'
    );
    expect(timerSvc).toContain('masterBus.removeRegisteredChannel(channelKey, channel)');
  });

  it('useHeaderDataStore reconnects header channel in-place without re-running loadOnce or leaking bus listeners', () => {
    const store = readSrc('src/stores/useHeaderDataStore.ts');
    expect(store).toContain('const connectHeaderChannel = () =>');
    expect(store).toContain('masterBus.forceRemoveRegisteredChannel(channelKey)');
    expect(store).toContain('masterBus.registerChannelFactory(channelKey');
    expect(store).toContain('masterBus.removeChannelFactory(channelKey)');
    expect(store).toContain('if (hasSubscribedOnce)');
    expect(store).toContain('refreshAllHeaderCounts()');
    expect(store).not.toContain('get().loadOnce(userId)');
  });

  it('PostgresSyncHooks attaches wake/online recovery listeners and cleans them up on destroy', () => {
    const sync = readSrc('src/services/PostgresSyncHooks.ts');
    expect(sync).toContain('private attachWakeListeners(userId: string): void');
    expect(sync).toContain("window.addEventListener('online', recoverIfNeeded)");
    expect(sync).toContain("window.addEventListener('focus', recoverIfNeeded)");
    expect(sync).toContain('if (this.cleanupWakeListeners)');
  });

  it('GlobalWaitlistListener recovers on wake/online and passes expected channel on watch teardown', () => {
    const waitlist = readSrc('src/components/common/GlobalWaitlistListener.tsx');
    expect(waitlist).toContain("window.addEventListener('online', handleWakeOrOnline)");
    expect(waitlist).toContain("window.addEventListener('focus', handleWakeOrOnline)");
    expect(waitlist).toContain('masterBus.removeRegisteredChannel(watchKey, watchChannel)');
  });

  it('NotificationService uses isolated notification-service topic and schedules reconnect on error/timeout', () => {
    const notif = readSrc('src/services/NotificationService.ts');
    expect(notif).toContain('.channel(`notification-service:${userId}`)');
    expect(notif).toContain('this.scheduleReconnect(userId, callbacks)');
  });

  it('BBJRecentHits and MultiTablePage quick-join spins use per-instance channel suffixes and catch up on reconnect', () => {
    const bbj = readSrc('src/components/bbj/BBJRecentHits.tsx');
    expect(bbj).toContain('bbj-recent-hits-${poolId}-${instanceSuffix}');
    expect(bbj).toContain('if (hasSubscribedOnce) setRevision((r) => r + 1)');

    const multi = readSrc('src/pages/MultiTablePage.tsx');
    expect(multi).toContain(
      "`quick-join-spins-${spinSheetScope.scopeClubIds.join('-')}-${instanceSuffix}`"
    );
    expect(multi).toContain('if (hasSubscribedOnce) schedule()');
  });

  it('Async resolveClubUUID realtime effects guard removeRegisteredChannel with acquiredChannel', () => {
    const asyncClubFiles = [
      'src/components/admin/AuditLog.tsx',
      'src/components/agent/AgentCashoutPanel.tsx',
      'src/pages/DisputeManagementPage.tsx',
      'src/pages/AdminDashboardPage.tsx',
      'src/pages/ClubAnnouncementsPage.tsx',
      'src/pages/ClubRulesPage.tsx',
      'src/pages/BadBeatJackpotPage.tsx',
      'src/pages/TournamentPage.tsx',
      'src/pages/AgentDashboardPage.tsx',
      'src/pages/ClubDetailPage.tsx',
      'src/pages/ClubSettingsPage.tsx',
      'src/pages/AgentManagementPage.tsx',
      'src/pages/PromotionsPage.tsx',
      'src/pages/AntiCheatPage.tsx',
      'src/pages/SuperAgentDashboard.tsx',
    ];
    for (const file of asyncClubFiles) {
      const src = readSrc(file);
      expect(src, `${file} should track acquiredChannel`).toContain('acquiredChannel');
      expect(src, `${file} should pass acquiredChannel to removeRegisteredChannel`).toContain(
        'removeRegisteredChannel(channelKey, acquiredChannel)'
      );
    }
  });

  it('TableWebSocket attaches wake/online listeners and updates username in-place without tearing down live table socket', () => {
    const tableWs = readSrc('src/services/TableWebSocket.ts');
    expect(tableWs).toContain('private attachWakeListeners(): void');
    expect(tableWs).toContain('setUsername(username: string): void');
    expect(tableWs).toContain('wsRef.current?.setUsername(username)');
    expect(tableWs).toContain('}, [tableId, userId]);');
  });

  it('TablePage seat-first-roster and seat-sitout channels isolate topics per instance, skip hidden-tab polls, and recover on wake/reconnect', () => {
    const tablePage = readSrc('src/pages/TablePage.tsx');
    expect(tablePage).toContain('`seat-first-roster-${tableId}-${instanceSuffix}`');
    expect(tablePage).toContain('`seat-sitout-${tableId}-${instanceSuffix}`');
    expect(tablePage).toContain("document.visibilityState === 'hidden'");
  });

  it('Live table & tournament side-components pass channel references to removeRegisteredChannel and catch up on reconnect', () => {
    const multi = readSrc('src/pages/MultiTablePage.tsx');
    expect(multi).toContain('masterBus.removeRegisteredChannel(chanKey, channel)');

    const waitlistMgr = readSrc('src/components/waitlist/WaitlistManager.tsx');
    expect(waitlistMgr).toContain('masterBus.removeRegisteredChannel(channelKey, channel)');

    const clubChat = readSrc('src/components/club/ClubChat.tsx');
    expect(clubChat).toContain('masterBus.removeRegisteredChannel(channelKey, channel)');

    const tournClock = readSrc('src/components/tournament/TournamentClock.tsx');
    expect(tournClock).toContain('masterBus.removeRegisteredChannel(channelKey, channel)');
  });
});
