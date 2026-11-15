import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";

import { Button } from "./button";

export function CopyButton({
  value,
  label = "Copy",
  kind = "primary",
  size = "small",
  fullWidth,
}: {
  value: string | null;
  label?: string;
  kind?: "primary" | "secondary";
  size?: "small" | "large";
  fullWidth?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <Button
      label={copied ? "Copied" : label}
      kind={kind}
      size={size}
      fullWidth={fullWidth}
      disabled={!value}
      haptic="none"
      onPress={async () => {
        if (!value) return;
        await Clipboard.setStringAsync(value);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setCopied(true);
      }}
    />
  );
}
