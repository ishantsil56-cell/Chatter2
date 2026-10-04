/**
 * Component tests (jest-expo + @testing-library/react-native).
 * Run:  npm run test:components
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@/services/storage', () => ({ parseMediaBody: () => null }));
jest.mock('../MediaContent', () => ({ MediaContent: () => null }));
jest.mock('@/services/messageCache', () => ({ getPlaintextSync: () => undefined }));
jest.mock('@/services/messages', () => ({ previewText: (_k: string, t: string) => t }));

import { DeliveryTicks } from '../DeliveryTicks';
import { ErrorBanner } from '../ErrorBanner';
import { MessageBubble } from '../MessageBubble';
import { initial } from '../Avatar';
import type { DecryptedMessage } from '@/types';

function msg(over: Partial<DecryptedMessage> = {}): DecryptedMessage {
  return {
    id: 'm1',
    chatId: 'c1',
    senderId: 'me',
    kind: 'text',
    envelopes: {},
    media: null,
    systemText: null,
    createdAt: 1_700_000_000_000,
    receipts: { me: 'sent', you: 'sent' },
    text: 'नमस्ते 😀',
    decrypted: true,
    ...over,
  } as DecryptedMessage;
}

describe('DeliveryTicks', () => {
  it.each([
    ['sending', 'Sending'],
    ['sent', 'Sent'],
    ['delivered', 'Delivered'],
    ['read', 'Read'],
    ['failed', 'Not sent'],
  ] as const)('announces %s', (status, label) => {
    render(<DeliveryTicks status={status} />);
    expect(screen.getByLabelText(label)).toBeTruthy();
  });
});

describe('ErrorBanner', () => {
  it('renders nothing without a message', () => {
    render(<ErrorBanner message={null} />);
    expect(screen.queryByTestId('error-banner')).toBeNull();
  });

  it('shows the message and calls retry / dismiss', () => {
    const onRetry = jest.fn();
    const onDismiss = jest.fn();
    render(<ErrorBanner message="You appear to be offline." onRetry={onRetry} onDismiss={onDismiss} />);
    expect(screen.getByText('You appear to be offline.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Retry'));
    fireEvent.press(screen.getByLabelText('Dismiss error'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('MessageBubble', () => {
  it('shows non-ASCII text unchanged', () => {
    render(<MessageBubble message={msg()} isMine memberIds={['me', 'you']} />);
    expect(screen.getByText('नमस्ते 😀')).toBeTruthy();
  });

  it('turns blue/“Read” only when every current member has read it', () => {
    const { rerender } = render(
      <MessageBubble message={msg({ receipts: { me: 'sent', a: 'read', b: 'delivered' } })} isMine memberIds={['me', 'a', 'b']} />,
    );
    expect(screen.getByLabelText('Delivered')).toBeTruthy();
    rerender(<MessageBubble message={msg({ receipts: { me: 'sent', a: 'read', b: 'read' } })} isMine memberIds={['me', 'a', 'b']} />);
    expect(screen.getByLabelText('Read')).toBeTruthy();
  });

  it('shows a spinner-state tick while sending', () => {
    render(<MessageBubble message={msg({ sendState: 'sending', pending: true })} isMine memberIds={['me', 'you']} />);
    expect(screen.getByLabelText('Sending')).toBeTruthy();
  });

  it('offers Retry and Delete on a failed send', () => {
    const onRetrySend = jest.fn();
    const onDiscardSend = jest.fn();
    render(
      <MessageBubble
        message={msg({ sendState: 'failed', outboxId: 'm1', sendError: 'You appear to be offline.' })}
        isMine
        memberIds={['me', 'you']}
        onRetrySend={onRetrySend}
        onDiscardSend={onDiscardSend}
      />,
    );
    expect(screen.getByText('You appear to be offline.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Retry sending this message'));
    fireEvent.press(screen.getByLabelText('Delete this unsent message'));
    expect(onRetrySend).toHaveBeenCalledWith('m1');
    expect(onDiscardSend).toHaveBeenCalledWith('m1');
  });

  it('lets the user retry an unreadable incoming message', () => {
    const onRetryDecrypt = jest.fn();
    render(
      <MessageBubble
        message={msg({ senderId: 'you', text: null, decrypted: false, decryptIssue: 'failed' })}
        isMine={false}
        onRetryDecrypt={onRetryDecrypt}
      />,
    );
    expect(screen.getByText('Can’t read this message yet')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Try again to read this message'));
    expect(onRetryDecrypt).toHaveBeenCalled();
  });

  it('describes a bubble to screen readers as one sentence', () => {
    render(<MessageBubble message={msg({ text: 'hello' })} isMine memberIds={['me', 'you']} />);
    expect(screen.getByLabelText(/^You: hello\. .*Sent$/)).toBeTruthy();
  });
});

describe('Avatar initials', () => {
  it('never splits emoji or Indic characters', () => {
    expect(initial('😀 Rahul')).toBe('😀R');
    expect(initial('ईशानी शर्मा')).toBe('ईश');
    expect(initial('   ')).toBe('?');
  });
});
