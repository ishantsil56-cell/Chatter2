import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, spacing, fontSize, fontWeight, radius, useTheme } from '@/theme';
import { AnimatedPressable } from './AnimatedPressable';

const AnimatedCard = Animated.createAnimatedComponent(Pressable);

/**
 * In-app confirmation dialog.
 *
 * Replaces the platform `Alert` so confirmations match IRIS rather than the
 * device: same near-black surfaces, same violet accent, same corner radius as
 * the rest of the app. `Alert` also can't be themed at all, which is why the
 * delete prompts looked like a different app.
 *
 * Usage:
 *   const dialog = useDialog();
 *   const ok = await dialog({ title: 'Delete chat?', message: '…', destructive: true });
 *   if (ok) { … }
 */
export interface DialogOptions {
  title: string;
  message?: string;
  /** Defaults to "OK". */
  confirmLabel?: string;
  /** Defaults to "Cancel". Pass null for a single-button dialog. */
  cancelLabel?: string | null;
  /** Renders the confirm button in the danger colour. */
  destructive?: boolean;
}

export type ShowDialog = (options: DialogOptions) => Promise<boolean>;

const DialogContext = createContext<ShowDialog>(() => Promise.resolve(false));

export function useDialog(): ShowDialog {
  return useContext(DialogContext);
}

export function DialogProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [current, setCurrent] = useState<DialogOptions | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  const showDialog = useCallback<ShowDialog>(
    (options) =>
      new Promise<boolean>((resolve) => {
        // If a dialog is somehow already open, settle it as cancelled first so
        // its caller never hangs on a promise that can no longer be resolved.
        resolver.current?.(false);
        resolver.current = resolve;
        setCurrent(options);
      }),
    [],
  );

  const close = useCallback((confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setCurrent(null);
  }, []);

  const showCancel = current?.cancelLabel !== null;

  // The card scales up + fades in on every open, while the backdrop keeps the
  // Modal's own fade. Driven by `current`, not by mount: Modal children stay
  // mounted while hidden, so a mount effect would play once, invisibly, and
  // never again.
  const theme = useTheme();
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (current === null) {
      enter.setValue(0);
      return;
    }
    if (theme.reduceMotion) {
      enter.setValue(1);
      return;
    }
    const animation = Animated.timing(enter, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [enter, current, theme.reduceMotion]);

  return (
    <DialogContext.Provider value={showDialog}>
      {children}
      <Modal
        visible={current !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => close(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => close(false)}>
          {/* Swallow taps on the card itself so they don't dismiss the dialog. */}
          <AnimatedCard
            style={[
              styles.card,
              {
                opacity: enter,
                transform: [
                  { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
                ],
              },
            ]}
            onPress={() => undefined}
          >
            <Text style={styles.title}>{current?.title}</Text>
            {current?.message ? <Text style={styles.message}>{current.message}</Text> : null}
            <View style={styles.actions}>
              {showCancel ? (
                <AnimatedPressable
                  style={[styles.button, styles.cancel]}
                  onPress={() => close(false)}
                  accessibilityRole="button"
                >
                  <Text style={styles.cancelText}>{current?.cancelLabel ?? 'Cancel'}</Text>
                </AnimatedPressable>
              ) : null}
              <AnimatedPressable
                style={[styles.button, current?.destructive ? styles.danger : styles.confirm]}
                onPress={() => close(true)}
                accessibilityRole="button"
              >
                <Text style={styles.confirmText}>{current?.confirmLabel ?? 'OK'}</Text>
              </AnimatedPressable>
            </View>
          </AnimatedCard>
        </Pressable>
      </Modal>
    </DialogContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: palette.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
  },
  title: {
    color: palette.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.sm,
  },
  message: {
    color: palette.textMuted,
    fontSize: fontSize.md,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  button: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    minWidth: 92,
    alignItems: 'center',
  },
  cancel: { backgroundColor: palette.surfaceHigh },
  cancelText: { color: palette.text, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  confirm: { backgroundColor: palette.accent },
  danger: { backgroundColor: palette.danger },
  confirmText: { color: palette.textInverse, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
});
