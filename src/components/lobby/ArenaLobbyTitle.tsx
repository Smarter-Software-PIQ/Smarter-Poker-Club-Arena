import { tournamentClockSpeed } from '../../utils/tournamentFilters';
import { titleCase } from '../../utils/titleCase';
import nightlyBadge from './console-art/nightly-20k.webp';
import './ArenaLobbyConsole.css';
import './MttConsole.css';
import './MttSurfaces.css';
import { readTournamentFormat } from '../../utils/tournamentPresentation';

import allinArt from './console-art/allin.webp';
import bountyArt from './console-art/bounty.webp';
import deepArt from './console-art/deep.webp';
import freebuyArt from './console-art/freebuy.webp';
import freerollArt from './console-art/freeroll.webp';
import freezeoutArt from './console-art/freezeout.webp';
import mttArt from './console-art/mtt.webp';
import mysteryArt from './console-art/mystery.webp';
import pkoArt from './console-art/pko.webp';
import rebuyArt from './console-art/rebuy.webp';
import satelliteArt from './console-art/satellite.webp';
import sngArt from './console-art/sng.webp';
import spinArt from './console-art/spin.webp';
import turboArt from './console-art/turbo.webp';
import freerollPlate from './console-art/plaque-freeroll.webp';
import freezeoutPlate from './console-art/plaque-freezeout.webp';
import turboPlate from './console-art/plaque-turbo.webp';
import pkoPlate from './console-art/plaque-pko.webp';
import mysteryPlate from './console-art/plaque-mystery.webp';
import spinPlate from './console-art/plaque-spin.webp';
import sngPlate from './console-art/plaque-sng.webp';
import satellitePlate from './console-art/plaque-satellite.webp';

const plaques = {
  freeroll: { src: freerollPlate, label: 'Freeroll' },
  freezeout: { src: freezeoutPlate, label: 'Freezeout' },
  turbo: { src: turboPlate, label: 'Turbo' },
  pko: { src: pkoPlate, label: 'Progressive Knockout' },
  mystery: { src: mysteryPlate, label: 'Mystery Bounty' },
  spin: { src: spinPlate, label: 'Diamond Spin' },
  sng: { src: sngPlate, label: 'Sit & Go' },
  satellite: { src: satellitePlate, label: 'Satellite' },
} as const;

const artwork = {
  allin: allinArt,
  bounty: bountyArt,
  deep: deepArt,
  freebuy: freebuyArt,
  freeroll: freerollArt,
  freezeout: freezeoutArt,
  mtt: mttArt,
  mystery: mysteryArt,
  pko: pkoArt,
  rebuy: rebuyArt,
  satellite: satelliteArt,
  sng: sngArt,
  spin: spinArt,
  turbo: turboArt,
};

type Format = {
  guaranteed_prize?: number | null;
  format_contract?: unknown;
  type?: string | null;
  tournament_type?: string | null;
  variant?: string | null;
  satellite_target_id?: string | null;
  satellite_target?: string | null;
  is_mystery_bounty?: boolean | null;
  is_pko?: boolean | null;
  is_bounty?: boolean | null;
  free_buy?: boolean | null;
  blind_structure?: unknown;
  starting_chips?: number | null;
  blind_speed?: string | null;
  is_turbo?: boolean | null;
  is_rebuy?: boolean | null;
  all_in_or_fold?: boolean | null;
  buy_in_amount?: number | null;
};

export function lobbyArtwork(format: Format = {}, kind = '') {
  const contract = readTournamentFormat(format);
  const labels = [format.tournament_type, format.variant, format.type, kind]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase().replace(/[ -]+/g, '_'));
  const matches = (...values: string[]) => values.some((value) => labels.includes(value));
  if (
    contract === 'seat-first-satellite-v1' ||
    matches('satellite') ||
    format.satellite_target_id ||
    format.satellite_target
  )
    return 'satellite';
  if (contract === 'spin-v1' || matches('spin', 'spin_and_go')) return 'spin';
  if (format.is_mystery_bounty || matches('mystery', 'mystery_bounty')) return 'mystery';
  if (format.is_pko || matches('pko', 'progressive', 'progressive_bounty', 'progressive_knockout'))
    return 'pko';
  if (format.is_bounty || matches('bounty')) return 'bounty';
  if (contract === 'sng-v1' || matches('sng', 'hu_sng', 'sit_and_go', 'heads_up')) return 'sng';
  if (matches('deep_stack')) return 'deep';
  if (format.all_in_or_fold) return 'allin';
  if (format.free_buy || matches('free_buy', 'mtt_free_buy')) return 'freebuy';
  if (matches('freeroll') || format.buy_in_amount === 0) return 'freeroll';
  const speed = tournamentClockSpeed(format) ?? format.blind_speed?.toLowerCase();
  if (
    format.is_turbo ||
    matches('turbo', 'hyper', 'hyper_turbo') ||
    ['turbo', 'hyper', 'hyper_turbo'].includes(speed ?? '')
  )
    return 'turbo';
  if (format.is_rebuy || matches('rebuy', 'mtt_rebuy')) return 'rebuy';
  if (matches('freezeout', 'mtt_freezeout')) return 'freezeout';
  return 'mtt';
}

function TitleGuarantee({ amount }: { amount?: number | null }) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  return (
    <span className="event-title-guarantee">
      {amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} Guaranteed
    </span>
  );
}

export function ArenaLobbyTitle({
  name,
  format,
  kind,
}: {
  name: string;
  format?: Format | null;
  kind?: string;
}) {
  const art = lobbyArtwork(format ?? {}, kind);
  if (name.trim().toLowerCase() === 'nightly 20k' && art !== 'satellite') {
    return (
      <span className="arena-format-plaque arena-nightly-badge" data-format={art}>
        <img src={nightlyBadge} alt="Nightly 20K" />
        <TitleGuarantee amount={format?.guaranteed_prize} />
      </span>
    );
  }
  if (Object.prototype.hasOwnProperty.call(plaques, art)) {
    const plaque = plaques[art as keyof typeof plaques];
    return (
      <span className="arena-format-plaque" data-format={art}>
        <img src={plaque.src} alt={plaque.label} />
        {name.trim().toLowerCase() !== plaque.label.toLowerCase() && (
          <strong>{titleCase(name)}</strong>
        )}
        <TitleGuarantee amount={format?.guaranteed_prize} />
      </span>
    );
  }
  return (
    <span className="arena-lobby-title" data-format={art}>
      <img src={artwork[art]} alt="" />
      <strong>{titleCase(name)}</strong>
      <TitleGuarantee amount={format?.guaranteed_prize} />
    </span>
  );
}
