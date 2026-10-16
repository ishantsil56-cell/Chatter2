import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { palette, radius, spacing, fontSize, fontWeight } from '@/theme';
import { useDiagStore } from '@/store/diagStore';
import { scope } from '@/utils/logger';

const log = scope('boundary');

interface Props {
  children: React.ReactNode;
  /** Named in the message, so it is obvious which part failed. */
  label?: string;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

/**
 * Catches a render error and keeps the app alive.
 *
 * Without this, any throw while rendering unmounts the whole React tree and
 * leaves a blank screen with no explanation — which is exactly what happened
 * when tapping a photo crashed the viewer. The error WAS recorded by the global
 * handler, but the interface was already gone by then, so the recording was
 * useless: there was nothing on screen to read it from.
 *
 * Caught here, the failure is confined to the subtree. The rest of the app keeps
 * running, the diagnostics overlay still works, and the message and component
 * stack are on screen — which is the difference between a bug we can diagnose
 * and a white rectangle.
 *
 * A class component because only classes can implement componentDidCatch; there
 * is no hook equivalent.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // The component stack is the part that says WHERE it broke, and it is not in
    // error.stack. Worth capturing separately.
    log.error('render error', error, info.componentStack);
    useDiagStore
      .getState()
      .setError(`${this.props.label ? `${this.props.label}: ` : ''}${error.message}`);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  private reset = (): void => {
    this.setState({ error: null, componentStack: null });
    useDiagStore.getState().setError(null);
  };

  render(): React.ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Something broke here</Text>
        <Text style={styles.message}>{error.message}</Text>

        {componentStack ? (
          <ScrollView style={styles.stackBox}>
            <Text style={styles.stack}>{componentStack.trim()}</Text>
          </ScrollView>
        ) : null}

        <Pressable
          onPress={this.reset}
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>

        <Text style={styles.hint}>
          The rest of the app is still running. If this keeps happening, screenshot this screen —
          the text above names what failed.
        </Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: palette.backgroundSolid,
  },
  title: { color: palette.danger, fontSize: fontSize.lg, fontWeight: fontWeight.semibold, marginBottom: spacing.sm },
  message: { color: palette.text, fontSize: fontSize.md, textAlign: 'center', marginBottom: spacing.md },
  stackBox: {
    maxHeight: 220,
    alignSelf: 'stretch',
    backgroundColor: palette.surfaceHigh,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  stack: { color: palette.textMuted, fontSize: fontSize.xs, fontFamily: 'monospace' },
  button: {
    backgroundColor: palette.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  buttonText: { color: palette.textInverse, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  hint: { color: palette.textMuted, fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.lg },
});
