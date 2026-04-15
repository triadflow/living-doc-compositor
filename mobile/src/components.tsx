import React from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle, StyleProp } from 'react-native';
import { colors, radii, spacing, type } from './theme';

// Small status/category chip — GitHub mobile-style pill.
export function Pill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}) {
  const palette = {
    neutral: { bg: colors.neutralBg, fg: colors.neutralInk },
    accent: { bg: colors.accentBg, fg: colors.accent },
    success: { bg: colors.successBg, fg: colors.success },
    warning: { bg: colors.warningBg, fg: colors.warning },
    danger: { bg: colors.dangerBg, fg: colors.danger },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      <Text style={[styles.pillText, { color: palette.fg }]}>{children}</Text>
    </View>
  );
}

// Repo-card-style row used for doc list entries.
export function DocCard({
  title,
  status,
  meta,
  onPress,
  onLongPress,
}: {
  title: string;
  status?: string;
  meta?: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.surface }]}
      android_ripple={{ color: colors.surface }}
    >
      <View style={styles.cardRow}>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {title}
          </Text>
          {meta ? <Text style={styles.cardMeta}>{meta}</Text> : null}
        </View>
        {status ? <Pill tone={statusTone(status)}>{status}</Pill> : null}
      </View>
    </Pressable>
  );
}

// Rough tone inference for human-entered status labels. Falls back to neutral.
function statusTone(raw: string): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
  const s = raw.toLowerCase();
  if (/\b(ship|green|done|ok|ready|ok|resolved|good)\b/.test(s)) return 'success';
  if (/\b(investigat|warn|pending|partial|outdated|stale|review)\b/.test(s)) return 'warning';
  if (/\b(fail|red|broken|blocked|error|incident)\b/.test(s)) return 'danger';
  if (/\b(overview|docs|info|ref)\b/.test(s)) return 'accent';
  return 'neutral';
}

// Generic empty-state for Inbox, errors, etc.
export function EmptyState({
  title,
  body,
  style,
}: {
  title: string;
  body?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.empty, style]}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  pillText: { ...type.tiny, textTransform: 'uppercase' },

  card: {
    backgroundColor: colors.surfaceElevated,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  cardTitleWrap: { flex: 1, gap: 4 },
  cardTitle: { ...type.bodyStrong, color: colors.text },
  cardMeta: { ...type.small, color: colors.textMuted },

  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: { ...type.h3, color: colors.text, textAlign: 'center' },
  emptyBody: { ...type.body, color: colors.textMuted, textAlign: 'center', maxWidth: 320 },
});
