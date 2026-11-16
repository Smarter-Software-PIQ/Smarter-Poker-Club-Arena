import { createContext } from 'react';
import { getAnimationSpeed } from '../../utils/animationSpeed';

/** A shared hand can play beside a live table without changing its animation clock. */
export const TableAnimationClock = createContext(getAnimationSpeed);
