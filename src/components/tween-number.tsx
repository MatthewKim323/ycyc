import { useEffect, useRef, useState } from "react";

import { Text } from "./text";
import type { TypeVariant } from "@/theme";

const DURATION = 500;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Integer counter that tweens to its new value over 500 ms with tabular figures. */
export function TweenNumber({ value, variant = "label", color }: { value: number; variant?: TypeVariant; color?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const t0 = Date.now();
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - t0) / DURATION);
      const next = Math.round(start + (value - start) * easeOutCubic(t));
      setShown(next);
      from.current = next;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <Text variant={variant} color={color} style={{ fontVariant: ["tabular-nums"] }}>
      {shown}
    </Text>
  );
}
