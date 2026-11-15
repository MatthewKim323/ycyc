import { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated";

import { motion, springs } from "./tokens";

/** Staggered entrance for the nth item of a list or stack of cards. */
export function enter(index = 0) {
  return FadeInDown.springify()
    .damping(springs.enter.damping)
    .stiffness(springs.enter.stiffness)
    .mass(springs.enter.mass)
    .delay(Math.min(index, 8) * motion.stagger);
}

export const fadeIn = FadeIn.duration(motion.fade);
export const fadeOut = FadeOut.duration(200);

/** Smooth reflow when siblings appear, resolve or change size. */
export const layout = LinearTransition.springify()
  .damping(springs.layout.damping)
  .stiffness(springs.layout.stiffness)
  .mass(springs.layout.mass);

/** Entrance curve for timed reveals. */
export const easeEnter = Easing.bezier(0.16, 1, 0.3, 1);
/** Fills, progress and counters. */
export const easeFill = Easing.out(Easing.cubic);

/** Crossfade between stages inside one screen. */
export const stageIn = FadeIn.duration(motion.crossfade);
export const stageOut = FadeOut.duration(200);
