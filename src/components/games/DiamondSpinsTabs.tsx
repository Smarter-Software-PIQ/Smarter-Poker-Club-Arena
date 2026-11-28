import { NavLink } from 'react-router-dom';
import styles from '../../pages/diamondGames.module.css';

/**
 * The Diamond Spins route tabs. `arena` (#SmarterDesign batch D1, 2026-11-28)
 * prints them as chrome keys in an arena switch, the current tab lit by its
 * own aria-current; only Earn Diamonds passes it, so the game pages keep
 * their printed links. Each link spells its literal route segment so
 * scripts/ci/check-route-targets.mjs validates all three targets statically.
 */
export default function DiamondSpinsTabs({ clubId, arena }: { clubId: string; arena?: boolean }) {
  const linkClass = arena ? undefined : styles.back;
  return (
    <nav className={arena ? 'arena-switch' : styles.spinsTabs} aria-label="Diamond Spins">
      <NavLink className={linkClass} to={`/clubs/${clubId}/wheel`}>
        Spin Wheel
      </NavLink>
      <NavLink className={linkClass} to={`/clubs/${clubId}/diamond-games`}>
        Bonus Games
      </NavLink>
      <NavLink className={linkClass} to={`/clubs/${clubId}/earn-diamonds`}>
        Earn Diamonds
      </NavLink>
    </nav>
  );
}
