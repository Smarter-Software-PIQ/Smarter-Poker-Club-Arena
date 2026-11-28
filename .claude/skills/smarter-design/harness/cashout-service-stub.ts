/* The harness owner id is not a UUID, so the real
   queue read refuses it; answer the Agent Desk queue with fixed requests. */
import * as real from '../../../../src/services/CashoutService';
export * from '../../../../src/services/CashoutService';
const hoursAgo = (h: number) => new Date(Date.now() - h * 36e5).toISOString();
const rows = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    clubId: '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3',
    playerId: '22222222-2222-4222-8222-222222222222',
    agentId: '33333333-3333-4333-8333-333333333333',
    amount: 18400.5,
    status: 'pending',
    createdAt: hoursAgo(8),
    playerName: 'RiverRat',
    playerNote: 'Weekend Cash Out Please',
    canDecide: true,
    canEscalate: true,
    isEscalated: false,
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    clubId: '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3',
    playerId: '55555555-5555-4555-8555-555555555555',
    agentId: '33333333-3333-4333-8333-333333333333',
    amount: 1234567,
    status: 'pending',
    createdAt: hoursAgo(2),
    playerName: 'NutFlush',
    canDecide: true,
    canEscalate: false,
    isEscalated: false,
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    clubId: '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3',
    playerId: '77777777-7777-4777-8777-777777777777',
    agentId: '33333333-3333-4333-8333-333333333333',
    amount: 250.25,
    status: 'pending',
    createdAt: hoursAgo(30),
    playerName: 'TurnTwo',
    canDecide: false,
    canEscalate: false,
    isEscalated: true,
  },
];
export const cashoutService = Object.create(real.cashoutService, {
  getAgentPendingCashouts: { value: async () => rows.map((r) => ({ ...r })) },
});
