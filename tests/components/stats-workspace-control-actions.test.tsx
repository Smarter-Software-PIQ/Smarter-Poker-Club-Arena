import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import WorkspaceTab from '../../src/pages/stats/WorkspaceTab';
import { statsWorkspaceService } from '../../src/services/StatsWorkspaceService';

vi.mock('../../src/services/StatsWorkspaceService', () => ({
  statsWorkspaceService: {
    load: vi.fn(),
    saveReport: vi.fn(),
    saveGoal: vi.fn(),
    addGoalProgress: vi.fn(),
    saveCollection: vi.fn(),
    addStudyHand: vi.fn(),
    saveAlertRule: vi.fn(),
    saveLeak: vi.fn(),
  },
}));

const date = '2026-09-24T12:00:00Z';
const goal = { id: 'goal1', title: 'Study Volume', metricKey: 'hands', baseline: 5, target: 40 };
const goalSettings = {
  direction: 'decrease',
  status: 'paused',
  endsAt: '2026-12-10T00:00:00Z',
} as const;
const alert = {
  id: 'alert1',
  name: 'My Rake',
  metricKey: 'rake_paid',
  comparator: 'gt',
  threshold: 19,
  enabled: true,
  cooldownMinutes: 60,
};
const leak = {
  id: 'leak1',
  leakKey: 'turn',
  title: 'Turn',
  severity: 'low',
  status: 'open',
  snapshot: { count: 10 },
  evidenceHandIds: ['hand1'],
  reportId: 'report1',
};
const service = vi.mocked(statsWorkspaceService);

function change(label: string, value: string, role?: 'textbox' | 'combobox') {
  const control = role
    ? screen.getByRole(role, { name: label, exact: true })
    : screen.getByLabelText(label, { exact: true });
  fireEvent.change(control, { target: { value } });
}

async function submit(label: string, receipt: string) {
  fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
  expect(await screen.findByText(receipt, { exact: true })).toBeVisible();
}

beforeEach(() => {
  vi.clearAllMocks();
  service.load.mockResolvedValue({
    ok: true,
    data: {
      reports: [],
      progress: [],
      goals: [{ ...goal, ...goalSettings, updatedAt: date }],
      alerts: [
        {
          ...alert,
          comparator: 'gt',
          updatedAt: date,
          evaluationMode: 'on_stats_refresh',
          lastEvaluatedAt: null,
          lastValue: null,
          lastTriggeredAt: null,
        },
      ],
      leaks: [{ ...leak, severity: 'low', status: 'open', updatedAt: date }],
      collections: [
        {
          id: 'collection1',
          name: 'Study',
          description: '',
          updatedAt: date,
          hands: [],
          handsCapped: false,
        },
      ],
      preferences: { dashboardLayout: [], privacyPresentationMode: false },
      coverage: { capped: false, rowLimit: 100 },
    },
  });
  service.saveGoal.mockResolvedValue({ ok: true, data: 'goal1' });
  service.addGoalProgress.mockResolvedValue({ ok: true, data: 'progress1' });
  service.saveCollection.mockResolvedValue({ ok: true, data: 'collection1' });
  service.addStudyHand.mockResolvedValue({ ok: true, data: true });
  service.saveAlertRule.mockResolvedValue({ ok: true, data: 'alert1' });
  service.saveReport.mockResolvedValue({ ok: true, data: 'report1' });
  service.saveLeak.mockResolvedValue({ ok: true, data: 'leak1' });
});

it('hydrates the selected goal and sends the chosen target and reading to that goal', async () => {
  render(<WorkspaceTab isOwnProfile />);
  await screen.findByText('Workspace Builder');
  change('Goal To Edit', goal.id);
  expect(screen.getByLabelText('Goal Title')).toHaveValue(goal.title);
  expect(screen.getByLabelText('Metric', { selector: 'input' })).toHaveValue(goal.metricKey);
  change('Target', '50');
  await submit('Save Goal', 'Goal Saved.');
  expect(service.saveGoal).toHaveBeenCalledWith({ ...goal, target: 50, ...goalSettings });
  change('Goal Title', 'New Volume');
  change('Metric', 'hands', 'textbox');
  change('Current Baseline', '0');
  change('Target', '10');
  await submit('Save Goal', 'Goal Saved.');
  expect(service.saveGoal).toHaveBeenLastCalledWith({
    id: null,
    title: 'New Volume',
    metricKey: 'hands',
    direction: 'increase',
    status: 'active',
    endsAt: null,
    baseline: 0,
    target: 10,
  });
  change('Goal', goal.id, 'combobox');
  change('Current Reading', '15');
  await submit('Record Progress', 'Goal Progress Saved.');
  expect(service.addGoalProgress).toHaveBeenCalledWith(goal.id, 15);
});

it('sends a collection name and the selected collection and hand references', async () => {
  render(<WorkspaceTab isOwnProfile />);
  await screen.findByText('Workspace Builder');
  change('Collection Name', 'Review Turn');
  await submit('Create Study Collection', 'Study Collection Saved.');
  expect(service.saveCollection).toHaveBeenCalledWith(null, 'Review Turn');
  change('Study Collection', 'collection1');
  change('Owned Hand Reference', ' hand1 ');
  await submit('Add Owned Hand', 'Owned Hand Added To Study Collection.');
  expect(service.addStudyHand).toHaveBeenCalledWith('collection1', 'hand1');
});

it('preserves source evidence, alert settings and the chosen leak when saving study actions', async () => {
  const report = {
    title: 'Window Study',
    sourceVersion: 'rules-v2',
    body: { hands: 11 },
    evidence: [{ hand_id: 'hand1' }],
    clubId: 'club1',
    rangeDays: 7,
    generatedAt: date,
  };
  render(<WorkspaceTab isOwnProfile ruleReport={report} />);
  await screen.findByText('Workspace Builder');
  await submit('Save Current Rule-Derived Report', 'Rule-Derived Report Saved.');
  const { generatedAt, ...fields } = report;
  expect(service.saveReport).toHaveBeenCalledWith({
    ...fields,
    sourceKind: 'rule_derived',
    idempotencyKey: 'rules:rules-v2:club1:7:' + generatedAt,
  });
  change('Alert Name', 'Threshold');
  change('Metric', 'pfr', 'combobox');
  change('Alert Above', '19.5');
  await submit('Save Refresh Alert', 'Refresh Alert Saved.');
  expect(service.saveAlertRule).toHaveBeenCalledWith({
    name: 'Threshold',
    metricKey: 'pfr',
    comparator: 'gt',
    threshold: 19.5,
  });
  await submit('Pause Alert', 'Alert State Saved.');
  expect(service.saveAlertRule).toHaveBeenLastCalledWith({ ...alert, enabled: false });
  change('Status For Turn', 'resolved');
  expect(await screen.findByText('Leak Status Saved.')).toBeVisible();
  expect(service.saveLeak).toHaveBeenCalledWith({
    leakKey: leak.leakKey,
    title: leak.title,
    severity: leak.severity,
    snapshot: leak.snapshot,
    evidenceHandIds: leak.evidenceHandIds,
    reportId: leak.reportId,
    status: 'resolved',
  });
});
