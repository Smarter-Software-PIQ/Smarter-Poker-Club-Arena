import { NavLink } from 'react-router-dom';
import styles from '../../pages/diamondGames.module.css';

const TABS = [
  ['wheel', 'Spin Wheel'],
  ['diamond-games', 'Bonus Games'],
  ['earn-diamonds', 'Earn Diamonds'],
] as const;

/**
 * The Diamond Spins route tabs. `arena` (#SmarterDesign batch D1, 2026-11-28)
 * prints them as chrome keys in an arena switch, the current tab lit by its
 * own aria-current; only Earn Diamonds passes it, so the game pages keep
 * their printed links.
 */
export default function DiamondSpinsTabs({ clubId, arena }: { clubId: string; arena?: boolean }) {
  return (
    <nav className={arena ? 'arena-switch' : styles.spinsTabs} aria-label="Diamond Spins">
      {TABS.map(([path, label]) => (
        <NavLink
          key={path}
          className={arena ? undefined : styles.back}
          to={`/clubs/${clubId}/${path}`}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
