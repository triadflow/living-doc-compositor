// GitHub mobile app-inspired light theme.
// Colors chosen to match the look of github.com/mobile: clean whites, neutral borders,
// a single blue accent, and familiar status hues.

export const colors = {
  bg: '#ffffff',
  surface: '#f6f8fa',
  surfaceElevated: '#ffffff',
  border: '#d0d7de',
  borderMuted: '#d8dee4',
  text: '#1f2328',
  textMuted: '#656d76',
  textSubtle: '#8b949e',
  accent: '#0969da',
  accentBg: '#ddf4ff',
  success: '#1a7f37',
  successBg: '#dcfce7',
  warning: '#9a6700',
  warningBg: '#fff8c5',
  danger: '#cf222e',
  dangerBg: '#ffebe9',
  neutralBg: '#eaeef2',
  neutralInk: '#59636e',
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const type = {
  h1: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.3 },
  h2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.2 },
  h3: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  small: { fontSize: 13, fontWeight: '400' as const },
  tiny: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.3 },
} as const;
