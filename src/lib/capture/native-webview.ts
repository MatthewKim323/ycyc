// Typed handle on react-native-webview. With TS 6 the package's default export types its props as the
// intersection of the iOS, Android and Windows props, which collapses to `never`. We render on iOS and
// Android only, so type it as iOS props plus the Android props we set.

import type { ComponentType, Ref } from "react";
import { WebView } from "react-native-webview";
import type { AndroidWebViewProps, IOSWebViewProps } from "react-native-webview/lib/WebViewTypes";

export interface WebViewHandle {
  injectJavaScript: (script: string) => void;
  reload: () => void;
}

export type NativeWebViewProps = IOSWebViewProps &
  Partial<Pick<AndroidWebViewProps, "setSupportMultipleWindows" | "thirdPartyCookiesEnabled" | "domStorageEnabled">> & {
    ref?: Ref<WebViewHandle>;
  };

export const NativeWebView = WebView as unknown as ComponentType<NativeWebViewProps>;

export type { WebViewMessageEvent, WebViewNavigation } from "react-native-webview/lib/WebViewTypes";
