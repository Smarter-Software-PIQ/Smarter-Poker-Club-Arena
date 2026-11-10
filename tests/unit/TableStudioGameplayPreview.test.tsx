import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  TableStudioGameplayPreview,
  type TableStudioPreviewSelection,
} from '../../src/components/table/TableStudioGameplayPreview';

const SELECTION: TableStudioPreviewSelection = {
  table_id: 'classic_green',
  background_id: 'midnight',
  button_id: 'classic-white',
  cards_id: 'classic_red',
};

describe('Table Studio gameplay preview avatars', () => {
  it('renders every resolved library portrait', () => {
    const avatarUrls = Array.from(
      { length: 6 },
      (_, index) => `/avatars/table/free-preview-${index}@2x.webp`
    );
    const { container } = render(
      <TableStudioGameplayPreview
        selection={SELECTION}
        avatarUrls={avatarUrls}
        finalTable={false}
      />
    );

    expect(
      Array.from(container.querySelectorAll('.studio-game-preview__seat > img')).map((image) =>
        image.getAttribute('src')
      )
    ).toEqual(avatarUrls);
  });

  it('keeps the hand tab, seat bounties and queued actions inside the selected control theme', () => {
    const { container } = render(
      <TableStudioGameplayPreview
        selection={{ ...SELECTION, button_id: 'gray-d-gear' }}
        avatarUrls={[]}
        finalTable={false}
      />
    );
    const theme = container.querySelector('[data-button-theme="gray-d-gear"]');
    expect(theme?.querySelector('.studio-game-preview__card-tab')).toHaveTextContent('8♥');
    expect(theme?.querySelectorAll('.studio-game-preview__bounty')).toHaveLength(6);
    expect(theme?.querySelector('.studio-game-preview__queue')).toHaveTextContent('✓ Call 300');
  });

  it('replaces a rejected portrait with the neutral seat silhouette', () => {
    const { container } = render(
      <TableStudioGameplayPreview
        selection={SELECTION}
        avatarUrls={['/avatars/table/missing.webp']}
        finalTable={false}
      />
    );
    const firstSeat = container.querySelector('.studio-game-preview__seat--1');
    const image = firstSeat?.querySelector('img');
    expect(image).not.toBeNull();

    fireEvent.error(image as HTMLImageElement);

    expect(firstSeat?.querySelector('img')).toBeNull();
    expect(firstSeat?.querySelector('.studio-game-preview__avatar-loading')).not.toBeNull();
  });
});
