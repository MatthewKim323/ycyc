import LottieView from "lottie-react-native";
import { useEffect, useRef } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

// Lordicon (wired outline, free set). Colors are baked to white and each file is trimmed to its
// hover segment, so frame 0 is the resting icon and play() runs the hover motion once.
// check.json keeps its draw-in segment instead; check-black.json is the same check for white fills.
const ICONS = {
  home: require("@/assets/icons/home.json"),
  library: require("@/assets/icons/grid-bento.json"),
  link: require("@/assets/icons/link.json"),
  apple: require("@/assets/icons/apple.json"),
  pushups: require("@/assets/icons/person-pushups.json"),
  lotus: require("@/assets/icons/lotus.json"),
  flower: require("@/assets/icons/flower.json"),
  drop: require("@/assets/icons/drop.json"),
  clock: require("@/assets/icons/clock.json"),
  check: require("@/assets/icons/check.json"),
  checkBlack: require("@/assets/icons/check-black.json"),
  warning: require("@/assets/icons/warning-triangle.json"),
  trash: require("@/assets/icons/trash-bin.json"),
  plus: require("@/assets/icons/plus-circle.json"),
  key: require("@/assets/icons/one-key.json"),
  arrow: require("@/assets/icons/arrows-right.json"),
  eye: require("@/assets/icons/eye.json"),
  api: require("@/assets/icons/api.json"),
  restApi: require("@/assets/icons/rest-api.json"),
  external: require("@/assets/icons/arrow-out-square.json"),
  fingerprint: require("@/assets/icons/fingerprint-circle.json"),
  globe: require("@/assets/icons/globe.json"),
  flame: require("@/assets/icons/bonfire.json"),
  pencil: require("@/assets/icons/file-pencil.json"),
  puzzle: require("@/assets/icons/puzzle-square.json"),
  chat: require("@/assets/icons/avatars-chatting.json"),
  badge: require("@/assets/icons/badge-ribbon.json"),
  medal: require("@/assets/icons/medal-first-place.json"),
  star: require("@/assets/icons/star.json"),
} as const;

export type IconName = keyof typeof ICONS;

// Icons trimmed to a draw-in segment start empty, so they always play once on mount.
const DRAW_IN = new Set<IconName>(["check", "checkBlack"]);

export function Icon({
  name,
  size = 24,
  playKey,
  autoPlay = false,
  loop = false,
  opacity = 1,
  style,
}: {
  name: IconName;
  size?: number;
  /** Change this value to play the icon's motion once. */
  playKey?: number | string;
  autoPlay?: boolean;
  loop?: boolean;
  opacity?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<LottieView>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (playKey === undefined) return;
    ref.current?.reset();
    ref.current?.play();
  }, [playKey]);

  return (
    <View pointerEvents="none" style={[{ width: size, height: size, opacity, overflow: "hidden" }, style]}>
      <LottieView
        ref={ref}
        source={ICONS[name]}
        autoPlay={autoPlay || DRAW_IN.has(name)}
        loop={loop}
        resizeMode="contain"
        style={{ width: size, height: size }}
      />
    </View>
  );
}
