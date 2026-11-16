import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "react-native-reanimated";

import { Text } from "@/components/text";
import type { TypeVariant } from "@/theme";

const DURATION = 700;
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** Counts from 0 on mount (after `delay`), then tweens between later values. Jumps under Reduce Motion. */
export function CountUp({
  value,
  delay = 0,
  variant = "heading",
  color,
  suffix = "",
}: {
  value: number;
  delay?: number;
  variant?: TypeVariant;
  color?: string;
  suffix?: string;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const from = useRef(reduced ? value : 0);
  const first = useRef(true);

  useEffect(() => {
    if (reduced) {
      from.current = value;
      return;
    }
    const start = from.current;
    if (start === value) return;
    let raf = 0;
    const wait = first.current ? delay : 0;
    first.current = false;
    const timer = setTimeout(() => {
      const t0 = Date.now();
      const tick = () => {
        const t = Math.min(1, (Date.now() - t0) / DURATION);
        const next = Math.round(start + (value - start) * easeOutExpo(t));
        from.current = next;
        setShown(next);
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, wait);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [value, delay, reduced]);

  return (
    <Text variant={variant} color={color} style={{ fontVariant: ["tabular-nums"] }} numberOfLines={1}>
      {(reduced ? value : shown).toLocaleString()}
      {suffix}
    </Text>
  );
}
