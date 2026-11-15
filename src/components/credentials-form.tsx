import { useRef, useState, type ComponentRef } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";

import { colors, enter, fonts, radius, space } from "@/theme";

import { Button } from "./button";
import { Text } from "./text";

/** Native email + password sign-in for apps whose login API we call directly (Strong, Flo). */
export function CredentialsForm({
  appName,
  bottomInset,
  submitting,
  error,
  onSubmit,
}: {
  appName: string;
  bottomInset: number;
  submitting: boolean;
  error: string | null;
  onSubmit: (username: string, password: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [focused, setFocused] = useState<"email" | "password" | null>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const valid = email.trim().length > 3 && password.length > 0;
  const submit = () => valid && !submitting && onSubmit(email.trim(), password);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Animated.View entering={enter(0)} style={styles.head}>
          <Text variant="title">Sign in to {appName}</Text>
          <Text variant="body" color={colors.textSecondary}>
            Use your {appName} email and password.
          </Text>
        </Animated.View>
        <Animated.View entering={enter(1)} style={styles.fields}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            onFocus={() => setFocused("email")}
            onBlur={() => setFocused(null)}
            style={[styles.input, focused === "email" && styles.inputFocused]}
            selectionColor={colors.text}
          />
          <TextInput
            ref={passwordRef}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
            onFocus={() => setFocused("password")}
            onBlur={() => setFocused(null)}
            style={[styles.input, focused === "password" && styles.inputFocused]}
            selectionColor={colors.text}
          />
        </Animated.View>
        {error ? (
          <Text variant="caption" color={colors.error}>
            {error}
          </Text>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: bottomInset + space.lg }]}>
        <Button label="Sign in" onPress={submit} disabled={!valid} loading={submitting} fullWidth />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { paddingHorizontal: space.gutter, paddingTop: space.xl, gap: space.xl },
  head: { gap: space.sm },
  fields: { gap: space.md },
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 16,
  },
  inputFocused: { borderColor: colors.textSecondary },
  footer: { paddingHorizontal: space.gutter, paddingTop: space.md },
});
