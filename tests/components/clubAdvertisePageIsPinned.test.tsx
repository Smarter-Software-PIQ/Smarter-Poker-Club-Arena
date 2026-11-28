/**
 * CLUB ADVERTISE PAGE IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign batch G1, 2026-11-28)
 *
 * ClubAdvertisePage (`/clubs/:clubId/advertise` and `/advertise`) moves from
 * eight SpadeConsole frames to the arena workspace with chrome cases, meters,
 * switches and dark wells. Every diamond balance, daily rate, flight cost,
 * campaign stat, day-by-day figure, refusal, error, and control state is
 * pinned before conversion and must remain unchanged.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';
import type {
  AdCampaign,
  AdCampaignDay,
  AdRateCard,
  SponsorAdvertiser,
} from '../../src/services/AdCampaignService';

const fixture = vi.hoisted(() => ({
  clubName: 'Kings Club',
  isStaff: true as boolean,
  diamonds: 12500 as number | null,
  rateCard: vi.fn(),
  list: vi.fn(),
  sponsorMine: vi.fn(),
  sponsorList: vi.fn(),
  report: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  confirm: vi.fn(async () => true),
}));

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { name: fixture.clubName }, error: null }),
        }),
      }),
    }),
    rpc: async () => ({ data: fixture.isStaff, error: null }),
  },
}));
vi.mock('../../src/lib/ownProfile', () => ({
  ownProfile: () => ({
    select: () => ({
      maybeSingle: async () => ({
        data: fixture.diamonds === null ? null : { diamonds: fixture.diamonds },
        error: null,
      }),
    }),
  }),
}));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'owner-1' } }),
}));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => fixture.toast,
}));
vi.mock('../../src/components/common/confirmDialog', () => ({
  confirmDialog: fixture.confirm,
}));
vi.mock('../../src/utils/clubIdResolver', () => ({
  resolveClubUUID: async () => 'club-uuid-1',
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/services/AdCampaignService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/AdCampaignService')>();
  return {
    ...actual,
    AdCampaignService: {
      ...actual.AdCampaignService,
      rateCard: (...args: unknown[]) => fixture.rateCard(...args),
      list: (...args: unknown[]) => fixture.list(...args),
      sponsorMine: (...args: unknown[]) => fixture.sponsorMine(...args),
      sponsorList: (...args: unknown[]) => fixture.sponsorList(...args),
      report: (...args: unknown[]) => fixture.report(...args),
    },
  };
});

import ClubAdvertisePage from '../../src/pages/ClubAdvertisePage';

const RATES: AdRateCard[] = [
  {
    slot: 'lobby_strip',
    diamondsPerDay: 500,
    minDays: 1,
    maxDays: 30,
    creativeWidth: 1200,
    creativeHeight: 200,
    maxBytes: 409600,
    isOpen: true,
    label: 'Lobby Strip',
    blurb: 'Runs Across The Main Lobby.',
  },
  {
    slot: 'session_summary',
    diamondsPerDay: 250,
    minDays: 1,
    maxDays: 30,
    creativeWidth: 900,
    creativeHeight: 300,
    maxBytes: 409600,
    isOpen: true,
    label: 'Session Summary',
    blurb: 'Shown When A Player Finishes A Session.',
  },
];

const CAMPAIGNS: AdCampaign[] = [
  {
    id: 'camp-live',
    clubId: 'club-uuid-1',
    clubName: 'Kings Club',
    name: 'Sunday Major',
    slot: 'lobby_strip',
    status: 'approved',
    displayStatus: 'live',
    scope: 'platform',
    startsAt: '2026-11-22T00:00:00Z',
    endsAt: '2026-11-29T00:00:00Z',
    days: 7,
    imageUrl: '/ad-creatives/club/club-uuid-1/lobby.webp',
    targetUrl: '/clubs/club-uuid-1/tournaments',
    headline: 'Sunday Deepstack 10K Guaranteed',
    diamondsCharged: 3500,
    diamondsRefunded: 0,
    submittedBy: 'owner-1',
    reviewedAt: '2026-11-21T18:00:00Z',
    reviewNote: 'Looks Sharp',
    createdAt: '2026-11-21T12:00:00Z',
    impressions: 4800,
    viewable: 3920,
    clicks: 184,
    viewers: 1240,
  },
  {
    id: 'camp-sub',
    clubId: 'club-uuid-1',
    clubName: 'Kings Club',
    name: 'Nightly Turbo',
    slot: 'session_summary',
    status: 'submitted',
    displayStatus: 'submitted',
    scope: 'own_club',
    startsAt: '2026-11-28T00:00:00Z',
    endsAt: '2026-12-05T00:00:00Z',
    days: 7,
    imageUrl: '',
    targetUrl: '/clubs/club-uuid-1/lobby',
    headline: 'Nightly Turbo Series',
    diamondsCharged: 1750,
    diamondsRefunded: 0,
    submittedBy: 'owner-1',
    reviewedAt: null,
    reviewNote: null,
    createdAt: '2026-11-28T09:00:00Z',
    impressions: 0,
    viewable: 0,
    clicks: 0,
    viewers: 0,
  },
];

const DAYS_REPORT: AdCampaignDay[] = [
  { day: '2026-11-26', viewers: 610, impressions: 2450, viewable: 1980, clicks: 96 },
  { day: '2026-11-27', viewers: 630, impressions: 2350, viewable: 1940, clicks: 88 },
];

const SPONSOR: SponsorAdvertiser = {
  advertiserId: 'adv-1',
  name: 'Acme Poker Supplies',
  contactEmail: 'ads@acme.example',
  status: 'active',
};

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

/**
 * Strip only the page head console's title band (`#club-advertise-title`),
 * which moves into `<ArenaWorkspaceHeader>` (already stripped by `surfacePin`).
 * Every balance figure, section head, rate card, form control and ledger row
 * stays in the reading.
 */
function pin(container: HTMLElement) {
  const clone = container.firstElementChild!.cloneNode(true) as HTMLElement;
  clone.querySelector('#club-advertise-title')?.closest('.sc__head')?.remove();
  return surfacePin(clone);
}

function mountClub() {
  return render(
    <MemoryRouter initialEntries={['/clubs/kings-club/advertise']}>
      <Routes>
        <Route path="/clubs/:clubId/advertise" element={<ClubAdvertisePage />} />
      </Routes>
    </MemoryRouter>
  );
}

function mountSponsor() {
  return render(
    <MemoryRouter initialEntries={['/advertise']}>
      <Routes>
        <Route path="/advertise" element={<ClubAdvertisePage mode="sponsor" />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.clubName = 'Kings Club';
  fixture.isStaff = true;
  fixture.diamonds = 12500;
  fixture.rateCard.mockResolvedValue(RATES);
  fixture.list.mockResolvedValue(CAMPAIGNS);
  fixture.sponsorMine.mockResolvedValue(null);
  fixture.sponsorList.mockResolvedValue([]);
  fixture.report.mockResolvedValue(DAYS_REPORT);
});

afterEach(cleanup);

describe('Club Advertise prints the same diamond figures, rates, stats and controls', () => {
  it('club mode loaded with campaigns and diamond balance', async () => {
    const { container } = mountClub();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button|button|Day By Day|aria-expanded=false",
          "button|button|Lobby Strip500 Diamonds Per Day1200 By 200Selected|aria-pressed=true",
          "button|button|Pay And Submit|disabled",
          "button|button|Session Summary250 Diamonds Per Day900 By 300|aria-pressed=false",
          "button|button|Withdraw And Refund|",
          "input|file||value=",
          "input|file||value=",
          "input|number||value=7",
          "input|text||value=",
          "select||Club LobbyClub TournamentsClub Announcements|value=",
          "select||Every Player On Smarter.PokerOnly Players Inside This Club|value=",
        ],
        "money": {
          "figures": [
            "12,500",
            "2 Open",
            "500 Diamonds Per Day",
            "1200 By 200",
            "250 Diamonds Per Day",
            "900 By 300",
            "1200 By 200",
            "400",
            "1080 By 1440",
            "600",
            "7 Day(s)",
            "3,500",
            "500 x 7 Day(s)",
            "2 Booked",
            "Sunday Deepstack 10K Guaranteed",
            "7",
            "3,500",
            "1,240",
            "4,800",
            "3,920",
            "184",
            "7",
            "1,750",
          ],
          "hooks": [],
        },
        "regions": [],
        "text": "Your Diamonds | 12,500 | The Rate Card | Where It Runs | Choose One Surface | 2 Open | Runs Across The Main Lobby. | Your Creative | Your Pictures | Both Are Required | Needed | The Surface Picture | Exactly | 1200 By 200 | Pixels, WebP, PNG Or JPEG, Under | 400 | KB. It Scales With The Page And Is Never Cropped. | Preview Appears Here | Choose A Picture | The Poster | When A Player Taps Your Advert It Opens Full Screen As This Poster, With One Button That Goes Where You Point. Exactly | 1080 By 1440 | Pixels, Under | 600 | KB. | Poster Appears Here | Choose A Poster | The Flight | The Details | 7 Day(s) | Headline | Read Aloud By Screen Readers, Printed Under The Poster, And Shown In Your Reports. Not Drawn On The Picture. | Tapping It Opens | Club Lobby | Club Tournaments | Club Announcements | Days | Starts As Soon As The House Approves It. | Who Sees It | Every Player On Smarter.Poker | Only Players Inside This Club | Total | 3,500 | Diamonds | 500 x 7 Day(s) | Your Ledger | Your Adverts | 2 Booked | Sunday Deepstack 10K Guaranteed | Live | Lobby Strip | 7 | Day(s) | <date> | To | <date> | 3,500 | Diamonds | Note From The House: | Looks Sharp | 1,240 | People | 4,800 | Shown | 3,920 | Seen | 184 | Taps | Nightly Turbo Series | Awaiting Review | Session Summary | 7 | Day(s) | <date> | To | <date> | 1,750 | Diamonds",
      }
    `);
  });

  it('club mode day-by-day report expanded', async () => {
    const { container } = mountClub();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Day By Day' }));
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button|button|Hide Day By Day|aria-expanded=true",
          "button|button|Lobby Strip500 Diamonds Per Day1200 By 200Selected|aria-pressed=true",
          "button|button|Pay And Submit|disabled",
          "button|button|Session Summary250 Diamonds Per Day900 By 300|aria-pressed=false",
          "button|button|Withdraw And Refund|",
          "input|file||value=",
          "input|file||value=",
          "input|number||value=7",
          "input|text||value=",
          "select||Club LobbyClub TournamentsClub Announcements|value=",
          "select||Every Player On Smarter.PokerOnly Players Inside This Club|value=",
        ],
        "money": {
          "figures": [
            "12,500",
            "2 Open",
            "500 Diamonds Per Day",
            "1200 By 200",
            "250 Diamonds Per Day",
            "900 By 300",
            "1200 By 200",
            "400",
            "1080 By 1440",
            "600",
            "7 Day(s)",
            "3,500",
            "500 x 7 Day(s)",
            "2 Booked",
            "Sunday Deepstack 10K Guaranteed",
            "7",
            "3,500",
            "1,240",
            "4,800",
            "3,920",
            "184",
            "610",
            "2,450",
            "1,980",
            "96",
            "630",
            "2,350",
            "1,940",
            "88",
            "7",
            "1,750",
          ],
          "hooks": [],
        },
        "regions": [],
        "text": "Your Diamonds | 12,500 | The Rate Card | Where It Runs | Choose One Surface | 2 Open | Runs Across The Main Lobby. | Your Creative | Your Pictures | Both Are Required | Needed | The Surface Picture | Exactly | 1200 By 200 | Pixels, WebP, PNG Or JPEG, Under | 400 | KB. It Scales With The Page And Is Never Cropped. | Preview Appears Here | Choose A Picture | The Poster | When A Player Taps Your Advert It Opens Full Screen As This Poster, With One Button That Goes Where You Point. Exactly | 1080 By 1440 | Pixels, Under | 600 | KB. | Poster Appears Here | Choose A Poster | The Flight | The Details | 7 Day(s) | Headline | Read Aloud By Screen Readers, Printed Under The Poster, And Shown In Your Reports. Not Drawn On The Picture. | Tapping It Opens | Club Lobby | Club Tournaments | Club Announcements | Days | Starts As Soon As The House Approves It. | Who Sees It | Every Player On Smarter.Poker | Only Players Inside This Club | Total | 3,500 | Diamonds | 500 x 7 Day(s) | Your Ledger | Your Adverts | 2 Booked | Sunday Deepstack 10K Guaranteed | Live | Lobby Strip | 7 | Day(s) | <date> | To | <date> | 3,500 | Diamonds | Note From The House: | Looks Sharp | 1,240 | People | 4,800 | Shown | 3,920 | Seen | 184 | Taps | Day | People | Shown | Seen | Taps | <date> | 610 | 2,450 | 1,980 | 96 | <date> | 630 | 2,350 | 1,940 | 88 | Nightly Turbo Series | Awaiting Review | Session Summary | 7 | Day(s) | <date> | To | <date> | 1,750 | Diamonds",
      }
    `);
  });

  it('club mode insufficient diamonds warning', async () => {
    fixture.diamonds = 200;
    const { container } = mountClub();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button|button|Day By Day|aria-expanded=false",
          "button|button|Lobby Strip500 Diamonds Per Day1200 By 200Selected|aria-pressed=true",
          "button|button|Pay And Submit|disabled",
          "button|button|Session Summary250 Diamonds Per Day900 By 300|aria-pressed=false",
          "button|button|Withdraw And Refund|",
          "input|file||value=",
          "input|file||value=",
          "input|number||value=7",
          "input|text||value=",
          "select||Club LobbyClub TournamentsClub Announcements|value=",
          "select||Every Player On Smarter.PokerOnly Players Inside This Club|value=",
        ],
        "money": {
          "figures": [
            "200",
            "2 Open",
            "500 Diamonds Per Day",
            "1200 By 200",
            "250 Diamonds Per Day",
            "900 By 300",
            "1200 By 200",
            "400",
            "1080 By 1440",
            "600",
            "7 Day(s)",
            "3,500",
            "500 x 7 Day(s)",
            "2 Booked",
            "Sunday Deepstack 10K Guaranteed",
            "7",
            "3,500",
            "1,240",
            "4,800",
            "3,920",
            "184",
            "7",
            "1,750",
          ],
          "hooks": [],
        },
        "regions": [],
        "text": "Your Diamonds | 200 | The Rate Card | Where It Runs | Choose One Surface | 2 Open | Runs Across The Main Lobby. | Your Creative | Your Pictures | Both Are Required | Needed | The Surface Picture | Exactly | 1200 By 200 | Pixels, WebP, PNG Or JPEG, Under | 400 | KB. It Scales With The Page And Is Never Cropped. | Preview Appears Here | Choose A Picture | The Poster | When A Player Taps Your Advert It Opens Full Screen As This Poster, With One Button That Goes Where You Point. Exactly | 1080 By 1440 | Pixels, Under | 600 | KB. | Poster Appears Here | Choose A Poster | The Flight | The Details | 7 Day(s) | Headline | Read Aloud By Screen Readers, Printed Under The Poster, And Shown In Your Reports. Not Drawn On The Picture. | Tapping It Opens | Club Lobby | Club Tournaments | Club Announcements | Days | Starts As Soon As The House Approves It. | Who Sees It | Every Player On Smarter.Poker | Only Players Inside This Club | Total | 3,500 | Diamonds | 500 x 7 Day(s) | Not Enough Diamonds For This Flight. | Your Ledger | Your Adverts | 2 Booked | Sunday Deepstack 10K Guaranteed | Live | Lobby Strip | 7 | Day(s) | <date> | To | <date> | 3,500 | Diamonds | Note From The House: | Looks Sharp | 1,240 | People | 4,800 | Shown | 3,920 | Seen | 184 | Taps | Nightly Turbo Series | Awaiting Review | Session Summary | 7 | Day(s) | <date> | To | <date> | 1,750 | Diamonds",
      }
    `);
  });

  it('club mode staff refused state', async () => {
    fixture.isStaff = false;
    const { container } = mountClub();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [],
        "text": "Staff Only | Refused | Only Club Staff Can Buy Adverts For This Club.",
      }
    `);
  });

  it('club mode load error state', async () => {
    fixture.rateCard.mockRejectedValue(new Error('Rate card unavailable'));
    const { container } = mountClub();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Retry|",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [],
        "text": "Could Not Load | Offline | Rate Card Unavailable",
      }
    `);
  });

  it('sponsor mode new advertiser', async () => {
    const { container } = mountSponsor();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button|button|Book It|disabled",
          "button|button|Lobby StripPriced On Request1200 By 200Selected|aria-pressed=true",
          "button|button|Session SummaryPriced On Request900 By 300|aria-pressed=false",
          "button|button|Start Advertising|disabled",
          "input|email||value=",
          "input|file||value=",
          "input|file||value=",
          "input|number||value=7",
          "input|text||value=",
          "input|text||value=",
          "input|url||value=",
        ],
        "money": {
          "figures": [
            "2 Open",
            "1200 By 200",
            "900 By 300",
            "1200 By 200",
            "400",
            "1080 By 1440",
            "600",
          ],
          "hooks": [],
        },
        "regions": [],
        "text": "Advertising As | Your Business | New | Business Name | Shown On The Popup As Sponsored By, So Players Know Who Is Speaking. | Contact Email (Optional) | Where Smarter.Poker Sends The Invoice And Any Questions. | The Rate Card | Where It Runs | Choose One Surface | 2 Open | Runs Across The Main Lobby. | Your Creative | Your Pictures | Both Are Required | Needed | The Surface Picture | Exactly | 1200 By 200 | Pixels, WebP, PNG Or JPEG, Under | 400 | KB. It Scales With The Page And Is Never Cropped. | Preview Appears Here | Choose A Picture | The Poster | When A Player Taps Your Advert It Opens Full Screen As This Poster, With One Button That Goes Where You Point. Exactly | 1080 By 1440 | Pixels, Under | 600 | KB. | Poster Appears Here | Choose A Poster | The Flight | The Details | Sponsor | Headline | Read Aloud By Screen Readers, Printed Under The Poster, And Shown In Your Reports. Not Drawn On The Picture. | The Button Sends Players To | A Full HTTPS Address On Your Own Site. It Opens In A New Tab And Never Leaves A Player Signed Out. | Days | Starts As Soon As The House Approves It. | Payment | Invoiced By Smarter.Poker After Review. Nothing Is Charged Here. | Save Your Business Details Above First. | Your Ledger | Your Adverts | None Yet | Nothing Yet. The First One Appears Here The Moment You Submit It.",
      }
    `);
  });

  it('sponsor mode active advertiser with booked flight', async () => {
    fixture.sponsorMine.mockResolvedValue(SPONSOR);
    fixture.sponsorList.mockResolvedValue([CAMPAIGNS[1]]);
    const { container } = mountSponsor();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button|button|Book It|disabled",
          "button|button|Lobby StripPriced On Request1200 By 200Selected|aria-pressed=true",
          "button|button|Save|",
          "button|button|Session SummaryPriced On Request900 By 300|aria-pressed=false",
          "button|button|Withdraw|",
          "input|email||value=ads@acme.example",
          "input|file||value=",
          "input|file||value=",
          "input|number||value=7",
          "input|text||value=",
          "input|text||value=Acme Poker Supplies",
          "input|url||value=",
        ],
        "money": {
          "figures": [
            "2 Open",
            "1200 By 200",
            "900 By 300",
            "1200 By 200",
            "400",
            "1080 By 1440",
            "600",
            "1 Booked",
            "7",
          ],
          "hooks": [],
        },
        "regions": [],
        "text": "Advertising As | Acme Poker Supplies | Active | Business Name | Shown On The Popup As Sponsored By, So Players Know Who Is Speaking. | Contact Email (Optional) | Where Smarter.Poker Sends The Invoice And Any Questions. | The Rate Card | Where It Runs | Choose One Surface | 2 Open | Runs Across The Main Lobby. | Your Creative | Your Pictures | Both Are Required | Needed | The Surface Picture | Exactly | 1200 By 200 | Pixels, WebP, PNG Or JPEG, Under | 400 | KB. It Scales With The Page And Is Never Cropped. | Preview Appears Here | Choose A Picture | The Poster | When A Player Taps Your Advert It Opens Full Screen As This Poster, With One Button That Goes Where You Point. Exactly | 1080 By 1440 | Pixels, Under | 600 | KB. | Poster Appears Here | Choose A Poster | The Flight | The Details | Sponsor | Headline | Read Aloud By Screen Readers, Printed Under The Poster, And Shown In Your Reports. Not Drawn On The Picture. | The Button Sends Players To | A Full HTTPS Address On Your Own Site. It Opens In A New Tab And Never Leaves A Player Signed Out. | Days | Starts As Soon As The House Approves It. | Payment | Invoiced By Smarter.Poker After Review. Nothing Is Charged Here. | Your Ledger | Your Adverts | 1 Booked | Nightly Turbo Series | Awaiting Review | Session Summary | 7 | Day(s) | <date> | To | <date>",
      }
    `);
  });

  it('sponsor mode paused advertiser', async () => {
    fixture.sponsorMine.mockResolvedValue({ ...SPONSOR, status: 'suspended' });
    fixture.sponsorList.mockResolvedValue([]);
    const { container } = mountSponsor();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button|button|Book It|disabled",
          "button|button|Lobby StripPriced On Request1200 By 200Selected|aria-pressed=true",
          "button|button|Save|",
          "button|button|Session SummaryPriced On Request900 By 300|aria-pressed=false",
          "input|email||value=ads@acme.example",
          "input|file||value=",
          "input|file||value=",
          "input|number||value=7",
          "input|text||value=",
          "input|text||value=Acme Poker Supplies",
          "input|url||value=",
        ],
        "money": {
          "figures": [
            "2 Open",
            "1200 By 200",
            "900 By 300",
            "1200 By 200",
            "400",
            "1080 By 1440",
            "600",
          ],
          "hooks": [],
        },
        "regions": [],
        "text": "Advertising As | Acme Poker Supplies | Paused | Your Advertising Account Is Paused. Contact Smarter.Poker To Resume. | Business Name | Shown On The Popup As Sponsored By, So Players Know Who Is Speaking. | Contact Email (Optional) | Where Smarter.Poker Sends The Invoice And Any Questions. | The Rate Card | Where It Runs | Choose One Surface | 2 Open | Runs Across The Main Lobby. | Your Creative | Your Pictures | Both Are Required | Needed | The Surface Picture | Exactly | 1200 By 200 | Pixels, WebP, PNG Or JPEG, Under | 400 | KB. It Scales With The Page And Is Never Cropped. | Preview Appears Here | Choose A Picture | The Poster | When A Player Taps Your Advert It Opens Full Screen As This Poster, With One Button That Goes Where You Point. Exactly | 1080 By 1440 | Pixels, Under | 600 | KB. | Poster Appears Here | Choose A Poster | The Flight | The Details | Sponsor | Headline | Read Aloud By Screen Readers, Printed Under The Poster, And Shown In Your Reports. Not Drawn On The Picture. | The Button Sends Players To | A Full HTTPS Address On Your Own Site. It Opens In A New Tab And Never Leaves A Player Signed Out. | Days | Starts As Soon As The House Approves It. | Payment | Invoiced By Smarter.Poker After Review. Nothing Is Charged Here. | Your Ledger | Your Adverts | None Yet | Nothing Yet. The First One Appears Here The Moment You Submit It.",
      }
    `);
  });
});
