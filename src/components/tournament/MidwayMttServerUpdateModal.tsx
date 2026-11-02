import React from 'react';
import Modal from '../common/Modal';
import { SpadeConsole } from '../console/SpadeConsole';
import { MIDWAY_MTT_SERVER_UPDATE_POPUP_MESSAGE } from '../../hooks/useTournamentStartHold';

export interface MidwayMttServerUpdateModalProps {
  isOpen: boolean;
  message?: string | null;
  onClose: () => void;
}

export function MidwayMttServerUpdateModal({
  isOpen,
  message,
  onClose,
}: MidwayMttServerUpdateModalProps) {
  if (!isOpen) return null;

  const displayMessage =
    typeof message === 'string' && message.trim()
      ? message.trim()
      : MIDWAY_MTT_SERVER_UPDATE_POPUP_MESSAGE;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="small"
      showCloseButton={false}
      ariaLabel="Server Update Notice"
    >
      <SpadeConsole
        eyebrow="Midway Union"
        title="Server Update Notice"
        subtitle="Multi-Table Tournaments"
        onClose={onClose}
        plates={{
          primary: {
            label: 'Understood',
            ink: 'gold',
            onClick: onClose,
            'data-testid': 'midway-mtt-update-modal-ack',
          } as React.ComponentProps<typeof SpadeConsole>['plates'] extends
            | { primary?: infer P }
            | undefined
            ? P
            : never,
        }}
      >
        <div
          className="sc-notice sc-notice--amber"
          role="status"
          aria-live="polite"
          data-testid="midway-mtt-update-modal-message"
          style={{
            fontSize: '0.95rem',
            fontWeight: 700,
            lineHeight: 1.55,
            letterSpacing: '0.02em',
            textAlign: 'center',
            padding: '16px 14px',
          }}
        >
          {displayMessage}
        </div>
      </SpadeConsole>
    </Modal>
  );
}

export default MidwayMttServerUpdateModal;
