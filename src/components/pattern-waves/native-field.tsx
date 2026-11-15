// Web uses the expo-gl renderer in index.tsx; the Skia renderer lives in native-field.native.tsx.
import { forwardRef } from "react";

import type { Settings } from "./engine";

export type NativeFieldHandle = {
  pointerDown: (x: number, y: number) => void;
  pointerMove: (x: number, y: number) => void;
  pointerLeave: () => void;
};

type Props = {
  settings: Settings | null;
  width: number;
  height: number;
  active: boolean;
  onError: () => void;
};

export const nativeFieldAvailable = false;

const NativeField = forwardRef<NativeFieldHandle, Props>(() => null);
NativeField.displayName = "NativeField";

export default NativeField;
