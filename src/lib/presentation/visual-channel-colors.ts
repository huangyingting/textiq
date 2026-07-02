import type { VisualStyle } from "./style-schema";

export const SUPPORTED_VISUAL_COLOR_CHANNELS = [
  "primary",
  "secondary",
  "accent",
  "muted",
] as const;

export type SupportedVisualColorChannel =
  (typeof SUPPORTED_VISUAL_COLOR_CHANNELS)[number];

export type ResolvedVisualChannelColors = Partial<
  Record<SupportedVisualColorChannel, string>
>;

const SUPPORTED_CHANNEL_SET = new Set<string>(SUPPORTED_VISUAL_COLOR_CHANNELS);

export const DEFAULT_VISUAL_CHANNEL_COLORS: Record<
  SupportedVisualColorChannel,
  string
> = {
  primary: "#2563eb",
  secondary: "#64748b",
  accent: "#f59e0b",
  muted: "#94a3b8",
};

export function isSupportedVisualColorChannel(
  channel: string,
): channel is SupportedVisualColorChannel {
  return SUPPORTED_CHANNEL_SET.has(channel);
}

export function normalizeVisualChannelColors(
  channelColors: VisualStyle["channelColors"] | undefined,
): {
  colors: ResolvedVisualChannelColors;
  unsupportedChannels: string[];
} {
  const colors: ResolvedVisualChannelColors = {};
  const unsupportedChannels: string[] = [];
  if (!channelColors) return { colors, unsupportedChannels };

  for (const [channel, value] of Object.entries(channelColors)) {
    if (!isSupportedVisualColorChannel(channel)) {
      unsupportedChannels.push(channel);
      continue;
    }
    if (typeof value === "string" && value.trim() !== "") {
      colors[channel] = value;
    }
  }

  return { colors, unsupportedChannels };
}

export function visualChannelColorWithDefaults(
  channelColors: VisualStyle["channelColors"] | undefined,
): Record<SupportedVisualColorChannel, string> {
  const { colors } = normalizeVisualChannelColors(channelColors);
  return {
    ...DEFAULT_VISUAL_CHANNEL_COLORS,
    ...colors,
  };
}
