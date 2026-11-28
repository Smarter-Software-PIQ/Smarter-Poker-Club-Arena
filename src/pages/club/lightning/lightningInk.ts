import styles from '../ClubLightningOperationsPage.module.css';

/** The inks a Lightning reading prints in: the smarter.poker schema only
 *  (#SmarterDesign, Dan 2026-11-27). */
export type LightningInk = 'silver' | 'white' | 'blue' | 'gold' | 'red' | 'green' | 'muted';

/** The class that carries one ink. Green prints as the chrome live blue. */
export function inkClass(ink: LightningInk): string {
  return styles[`ink_${ink}`];
}
