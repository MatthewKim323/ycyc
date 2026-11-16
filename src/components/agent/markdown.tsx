import { Fragment, type ReactNode } from "react";
import { Linking, Platform, ScrollView, StyleSheet, Text as RNText, View } from "react-native";
import Animated from "react-native-reanimated";

import { colors, fadeIn, fonts, hairline, space } from "@/theme";

// Small markdown renderer for assistant replies. Pure JS, tolerant of partial text while a reply
// streams: anything unclosed (a lone ** or `) renders as plain text until it closes.

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: number; text: string }
  | { kind: "li"; ordered: boolean; marker: string; depth: number; text: string }
  | { kind: "code"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBER = /^(\s*)(\d+)[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join("\n") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i++]!);
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const next = lines[i + 1];
    if (line.includes("|") && next !== undefined && TABLE_SEP.test(next)) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) rows.push(cells(lines[i++]!));
      i--;
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: "h", level: h[1]!.length, text: h[2]! });
      continue;
    }
    const b = BULLET.exec(line);
    if (b) {
      flush();
      blocks.push({ kind: "li", ordered: false, marker: "•", depth: Math.floor(b[1]!.length / 2), text: b[2]! });
      continue;
    }
    const n = NUMBER.exec(line);
    if (n) {
      flush();
      blocks.push({ kind: "li", ordered: true, marker: `${n[2]}.`, depth: Math.floor(n[1]!.length / 2), text: n[3]! });
      continue;
    }
    // A wrapped line right after a list item continues that item.
    const prev = blocks[blocks.length - 1];
    if (!para.length && prev?.kind === "li" && /^\s{2,}\S/.test(line)) {
      prev.text += ` ${line.trim()}`;
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

const open = (url: string) => {
  Linking.openURL(url).catch(() => {});
};

/** Inline spans: `code`, **bold**, *italic*, [link](url). Unclosed markers stay literal. */
function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = "";
  let i = 0;
  let n = 0;
  const push = (node: ReactNode) => {
    if (buf) out.push(buf);
    buf = "";
    out.push(<Fragment key={`${key}-${n++}`}>{node}</Fragment>);
  };
  while (i < text.length) {
    const rest = text.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^`([^`\n]+)`/.exec(rest))) {
      push(<RNText style={styles.code}>{m[1]}</RNText>);
    } else if ((m = /^\*\*(?=\S)([\s\S]+?)\*\*/.exec(rest)) || (m = /^__(?=\S)([\s\S]+?)__/.exec(rest))) {
      push(<RNText style={styles.bold}>{inline(m[1]!, `${key}b${n}`)}</RNText>);
    } else if ((m = /^\*(?=[^\s*])([^*\n]+?)\*/.exec(rest)) || (m = /^_(?=[^\s_])([^_\n]+?)_(?![A-Za-z0-9])/.exec(rest))) {
      push(<RNText style={styles.italic}>{inline(m[1]!, `${key}e${n}`)}</RNText>);
    } else if ((m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest))) {
      const url = m[2]!;
      push(
        <RNText style={styles.link} onPress={() => open(url)} accessibilityRole="link">
          {inline(m[1]!, `${key}l${n}`)}
        </RNText>,
      );
    } else if ((m = /^https?:\/\/[^\s)]+[^\s).,;:!?]/.exec(rest))) {
      const url = m[0];
      push(
        <RNText style={styles.link} onPress={() => open(url)} accessibilityRole="link">
          {url}
        </RNText>,
      );
    } else {
      buf += text[i];
      i++;
      continue;
    }
    i += m[0].length;
  }
  if (buf) out.push(buf);
  return out;
}

const HEADING_STYLE = [null, "h1", "h2", "h3", "h3", "h3", "h3"] as const;

function BlockView({ block, k }: { block: Block; k: string }) {
  switch (block.kind) {
    case "p":
      return <RNText style={styles.body}>{inline(block.text, k)}</RNText>;
    case "h":
      return <RNText style={[styles.body, styles[HEADING_STYLE[block.level] ?? "h3"]]}>{inline(block.text, k)}</RNText>;
    case "li":
      return (
        <View style={[styles.li, { paddingLeft: block.depth * space.lg }]}>
          <RNText style={[styles.body, styles.marker, block.ordered && styles.markerNum]}>{block.marker}</RNText>
          <RNText style={[styles.body, styles.liText]}>{inline(block.text, k)}</RNText>
        </View>
      );
    case "code":
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.codeBlock}>
          <RNText style={styles.codeText}>{block.text}</RNText>
        </ScrollView>
      );
    case "table": {
      const cols = Math.max(block.head.length, ...block.rows.map((r) => r.length));
      const row = (r: string[], head: boolean, ri: number) => (
        <View key={ri} style={[styles.tr, ri < block.rows.length - 1 || head ? styles.trRule : null]}>
          {Array.from({ length: cols }, (_, ci) => (
            <View key={ci} style={styles.td}>
              <RNText style={head ? styles.th : styles.cell}>{inline(r[ci] ?? "", `${k}t${ri}-${ci}`)}</RNText>
            </View>
          ))}
        </View>
      );
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.table}>
            {row(block.head, true, -1)}
            {block.rows.map((r, ri) => row(r, false, ri))}
          </View>
        </ScrollView>
      );
    }
  }
}

/** Assistant reply as rich text. New blocks fade in as they stream. */
export function Markdown({ text }: { text: string }) {
  const blocks = parse(text);
  return (
    <View style={styles.root}>
      {blocks.map((b, i) => (
        <Animated.View key={i} entering={fadeIn} style={b.kind === "li" && blocks[i - 1]?.kind === "li" ? styles.tight : null}>
          <BlockView block={b} k={`m${i}`} />
        </Animated.View>
      ))}
    </View>
  );
}

const mono = Platform.select({ ios: "Menlo", default: "monospace" });

const styles = StyleSheet.create({
  root: { gap: space.md },
  tight: { marginTop: -space.sm },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: colors.text },
  bold: { fontFamily: fonts.semibold },
  italic: { fontStyle: "italic" },
  link: { textDecorationLine: "underline", color: colors.text },
  code: { fontFamily: mono, fontSize: 14, color: colors.text, backgroundColor: colors.surface2 },
  h1: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.3, marginTop: space.xs },
  h2: { fontFamily: fonts.semibold, fontSize: 19, lineHeight: 26, letterSpacing: -0.2, marginTop: space.xs },
  h3: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 24 },
  li: { flexDirection: "row" },
  marker: { width: 20, color: colors.textSecondary },
  markerNum: { width: 24, fontVariant: ["tabular-nums"] },
  liText: { flex: 1 },
  codeBlock: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: hairline, borderColor: colors.border },
  codeText: { fontFamily: mono, fontSize: 13, lineHeight: 20, color: colors.text, padding: space.md },
  table: { borderTopWidth: hairline, borderBottomWidth: hairline, borderColor: colors.border },
  tr: { flexDirection: "row" },
  trRule: { borderBottomWidth: hairline, borderColor: colors.border },
  td: { minWidth: 96, maxWidth: 220, paddingVertical: space.sm, paddingRight: space.lg },
  th: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  cell: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.text },
});
