import { Text as RNText, type TextProps } from "react-native";

import { colors, type, type TypeVariant } from "@/theme";

export function Text({
  variant = "body",
  color = colors.text,
  style,
  ...rest
}: TextProps & { variant?: TypeVariant; color?: string }) {
  return <RNText {...rest} style={[type[variant], { color }, style]} />;
}
