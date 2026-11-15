import type { TextStyle } from "react-native";

export const colors = {
  bg: "#000000",
  surface: "#0B0B0B",
  surface2: "#141414",
  border: "#1F1F1F",
  borderStrong: "#2A2A2A",
  text: "#FFFFFF",
  textSecondary: "#A1A1A1",
  textTertiary: "#6B6B6B",
  accent: "#FFFFFF",
  onAccent: "#000000",
  live: "#FFFFFF",
  building: "rgba(255,255,255,0.5)",
  error: "#FF453A",
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  gutter: 16,
} as const;

export const radius = {
  sm: 10,
  md: 12,
  card: 16,
  pill: 999,
} as const;

export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
} as const;

// Font family carries the weight; never set fontWeight with a custom face.
export const type = {
  title: { fontFamily: fonts.semibold, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
  heading: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  rowTitle: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22, letterSpacing: -0.1 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 },
  button: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  label: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  micro: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, letterSpacing: 0.1 },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

// One calm spring family: critically damped or close to it, no visible bounce.
export const springs = {
  press: { damping: 26, stiffness: 420, mass: 0.6 },
  release: { damping: 20, stiffness: 260, mass: 0.7 },
  enter: { damping: 22, stiffness: 170, mass: 1 },
  layout: { damping: 24, stiffness: 200, mass: 1 },
  pop: { damping: 18, stiffness: 180, mass: 0.8 },
  sheet: { damping: 30, stiffness: 300, mass: 1 },
} as const;

export const motion = {
  fade: 280,
  crossfade: 280,
  pressScale: 0.97,
  stagger: 55,
} as const;

export const hairline = 1;
