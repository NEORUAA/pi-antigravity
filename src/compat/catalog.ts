/** Pinned catalog adapted from codex2api d8e1981f proxy/antigravity_models.go.
 * Tables are intentionally not fetched at runtime. See docs/CODEX_PARITY.md. */
export type Variant = { level: string; wire: string; budget?: number };
type Definition = { id: string; wire?: string; defaultLevel?: string; variants: Variant[] };
export const CODEX_CATALOG: Definition[] = [
  {
    id: "gemini-3.6-flash-low",
    wire: "gemini-3.6-flash-low",
    variants: [
      {
        level: "low",
        wire: "gemini-3.6-flash-low",
        budget: 4096,
      },
    ],
  },
  {
    id: "gemini-3.6-flash-medium",
    wire: "gemini-3.6-flash-medium",
    variants: [
      {
        level: "medium",
        wire: "gemini-3.6-flash-medium",
        budget: 8192,
      },
    ],
  },
  {
    id: "gemini-3.6-flash-high",
    wire: "gemini-3.6-flash-high",
    variants: [
      {
        level: "high",
        wire: "gemini-3.6-flash-high",
        budget: 24576,
      },
    ],
  },
  {
    id: "gemini-3.7-flash-low",
    wire: "gemini-3.7-flash-tiered",
    variants: [
      {
        level: "low",
        wire: "gemini-3.7-flash-tiered",
        budget: 4096,
      },
    ],
  },
  {
    id: "gemini-3.7-flash-medium",
    wire: "gemini-3.7-flash-tiered",
    variants: [
      {
        level: "medium",
        wire: "gemini-3.7-flash-tiered",
        budget: 8192,
      },
    ],
  },
  {
    id: "gemini-3.7-flash-high",
    wire: "gemini-3.7-flash-tiered",
    variants: [
      {
        level: "high",
        wire: "gemini-3.7-flash-tiered",
        budget: 24576,
      },
    ],
  },
  {
    id: "gemini-3.8-flash-low",
    wire: "gemini-3.8-flash-tiered",
    variants: [
      {
        level: "low",
        wire: "gemini-3.8-flash-tiered",
      },
    ],
  },
  {
    id: "gemini-3.8-flash-medium",
    wire: "gemini-3.8-flash-tiered",
    variants: [
      {
        level: "medium",
        wire: "gemini-3.8-flash-tiered",
      },
    ],
  },
  {
    id: "gemini-3.8-flash-high",
    wire: "gemini-3.8-flash-tiered",
    variants: [
      {
        level: "high",
        wire: "gemini-3.8-flash-tiered",
      },
    ],
  },
  {
    id: "gemini-4-argon-low",
    wire: "gemini-4-argon-high",
    variants: [
      {
        level: "low",
        wire: "gemini-4-argon-high",
      },
    ],
  },
  {
    id: "gemini-4-argon-medium",
    wire: "gemini-4-argon-high",
    variants: [
      {
        level: "medium",
        wire: "gemini-4-argon-high",
      },
    ],
  },
  {
    id: "gemini-4-argon-high",
    wire: "gemini-4-argon-high",
    variants: [
      {
        level: "high",
        wire: "gemini-4-argon-high",
      },
    ],
  },
  {
    id: "gemini-4-neon-low",
    wire: "gemini-4-neon-low",
    variants: [
      {
        level: "low",
        wire: "gemini-4-neon-low",
      },
    ],
  },
  {
    id: "gemini-4-neon-medium",
    wire: "gemini-4-neon-medium",
    variants: [
      {
        level: "medium",
        wire: "gemini-4-neon-medium",
      },
    ],
  },
  {
    id: "gemini-4-neon-high",
    wire: "gemini-4-neon-high",
    variants: [
      {
        level: "high",
        wire: "gemini-4-neon-high",
      },
    ],
  },
  {
    id: "gemini-4-neon-xhigh",
    wire: "gemini-4-neon-xhigh",
    variants: [
      {
        level: "xhigh",
        wire: "gemini-4-neon-xhigh",
      },
    ],
  },
  {
    id: "gemini-4-carbon-low",
    wire: "gemini-4-carbon-low",
    variants: [
      {
        level: "low",
        wire: "gemini-4-carbon-low",
      },
    ],
  },
  {
    id: "gemini-4-carbon-medium",
    wire: "gemini-4-carbon-medium",
    variants: [
      {
        level: "medium",
        wire: "gemini-4-carbon-medium",
      },
    ],
  },
  {
    id: "gemini-4-carbon-high",
    wire: "gemini-4-carbon-high",
    variants: [
      {
        level: "high",
        wire: "gemini-4-carbon-high",
      },
    ],
  },
  {
    id: "gemini-4-hydrogen-low",
    wire: "gemini-4-hydrogen-low",
    variants: [
      {
        level: "low",
        wire: "gemini-4-hydrogen-low",
      },
    ],
  },
  {
    id: "gemini-4-hydrogen-medium",
    wire: "gemini-4-hydrogen-medium",
    variants: [
      {
        level: "medium",
        wire: "gemini-4-hydrogen-medium",
      },
    ],
  },
  {
    id: "gemini-4-hydrogen-high",
    wire: "gemini-4-hydrogen-high",
    variants: [
      {
        level: "high",
        wire: "gemini-4-hydrogen-high",
      },
    ],
  },
  {
    id: "gemini-4-hydrogen-xhigh",
    wire: "gemini-4-hydrogen-xhigh",
    variants: [
      {
        level: "xhigh",
        wire: "gemini-4-hydrogen-xhigh",
      },
    ],
  },
  {
    id: "gemini-3.1-pro-low",
    wire: "gemini-3.1-pro-low",
    variants: [
      {
        level: "low",
        wire: "gemini-3.1-pro-low",
        budget: 1001,
      },
    ],
  },
  {
    id: "gemini-3.1-pro-high",
    wire: "gemini-pro-agent",
    variants: [
      {
        level: "high",
        wire: "gemini-pro-agent",
        budget: 10001,
      },
    ],
  },
  {
    id: "claude-opus-5-5-low",
    wire: "claude-opus-5-5-low",
    variants: [
      {
        level: "low",
        wire: "claude-opus-5-5-low",
      },
    ],
  },
  {
    id: "claude-opus-5-5-medium",
    wire: "claude-opus-5-5-medium",
    variants: [
      {
        level: "medium",
        wire: "claude-opus-5-5-medium",
      },
    ],
  },
  {
    id: "claude-opus-5-5-high",
    wire: "claude-opus-5-5-high",
    variants: [
      {
        level: "high",
        wire: "claude-opus-5-5-high",
      },
    ],
  },
  {
    id: "claude-sonnet-5-5-low",
    wire: "claude-sonnet-5-5-low",
    variants: [
      {
        level: "low",
        wire: "claude-sonnet-5-5-low",
      },
    ],
  },
  {
    id: "claude-sonnet-5-5-medium",
    wire: "claude-sonnet-5-5-medium",
    variants: [
      {
        level: "medium",
        wire: "claude-sonnet-5-5-medium",
      },
    ],
  },
  {
    id: "claude-sonnet-5-5-high",
    wire: "claude-sonnet-5-5-high",
    variants: [
      {
        level: "high",
        wire: "claude-sonnet-5-5-high",
      },
    ],
  },
  {
    id: "claude-opus-4-6-thinking",
    wire: "claude-opus-4-6-thinking",
    variants: [],
  },
  {
    id: "claude-sonnet-4-6",
    wire: "claude-sonnet-4-6",
    variants: [],
  },
  {
    id: "gpt-oss-120b-medium",
    wire: "gpt-oss-120b-medium",
    variants: [],
  },
  {
    id: "gemini-3.6-flash",
    defaultLevel: "medium",
    variants: [
      {
        level: "low",
        wire: "gemini-3.6-flash-low",
        budget: 4096,
      },
      {
        level: "medium",
        wire: "gemini-3.6-flash-medium",
        budget: 8192,
      },
      {
        level: "high",
        wire: "gemini-3.6-flash-high",
        budget: 24576,
      },
    ],
  },
  {
    id: "gemini-3.7-flash",
    defaultLevel: "medium",
    variants: [
      {
        level: "low",
        wire: "gemini-3.7-flash-tiered",
        budget: 4096,
      },
      {
        level: "medium",
        wire: "gemini-3.7-flash-tiered",
        budget: 8192,
      },
      {
        level: "high",
        wire: "gemini-3.7-flash-tiered",
        budget: 24576,
      },
    ],
  },
  {
    id: "gemini-3.8-flash",
    defaultLevel: "low",
    variants: [
      {
        level: "low",
        wire: "gemini-3.8-flash-tiered",
      },
      {
        level: "medium",
        wire: "gemini-3.8-flash-tiered",
      },
      {
        level: "high",
        wire: "gemini-3.8-flash-tiered",
      },
    ],
  },
  {
    id: "gemini-4-argon",
    defaultLevel: "high",
    variants: [
      {
        level: "low",
        wire: "gemini-4-argon-high",
      },
      {
        level: "medium",
        wire: "gemini-4-argon-high",
      },
      {
        level: "high",
        wire: "gemini-4-argon-high",
      },
    ],
  },
  {
    id: "gemini-4-neon",
    defaultLevel: "high",
    variants: [
      {
        level: "low",
        wire: "gemini-4-neon-low",
      },
      {
        level: "medium",
        wire: "gemini-4-neon-medium",
      },
      {
        level: "high",
        wire: "gemini-4-neon-high",
      },
      {
        level: "xhigh",
        wire: "gemini-4-neon-xhigh",
      },
    ],
  },
  {
    id: "gemini-4-carbon",
    defaultLevel: "high",
    variants: [
      {
        level: "low",
        wire: "gemini-4-carbon-low",
      },
      {
        level: "medium",
        wire: "gemini-4-carbon-medium",
      },
      {
        level: "high",
        wire: "gemini-4-carbon-high",
      },
    ],
  },
  {
    id: "gemini-4-hydrogen",
    defaultLevel: "high",
    variants: [
      {
        level: "low",
        wire: "gemini-4-hydrogen-low",
      },
      {
        level: "medium",
        wire: "gemini-4-hydrogen-medium",
      },
      {
        level: "high",
        wire: "gemini-4-hydrogen-high",
      },
      {
        level: "xhigh",
        wire: "gemini-4-hydrogen-xhigh",
      },
    ],
  },
  {
    id: "gemini-3.1-pro",
    defaultLevel: "high",
    variants: [
      {
        level: "low",
        wire: "gemini-3.1-pro-low",
        budget: 1001,
      },
      {
        level: "high",
        wire: "gemini-pro-agent",
        budget: 10001,
      },
    ],
  },
  {
    id: "claude-opus-5-5",
    defaultLevel: "high",
    variants: [
      {
        level: "low",
        wire: "claude-opus-5-5-low",
      },
      {
        level: "medium",
        wire: "claude-opus-5-5-medium",
      },
      {
        level: "high",
        wire: "claude-opus-5-5-high",
      },
    ],
  },
  {
    id: "claude-sonnet-5-5",
    defaultLevel: "high",
    variants: [
      {
        level: "low",
        wire: "claude-sonnet-5-5-low",
      },
      {
        level: "medium",
        wire: "claude-sonnet-5-5-medium",
      },
      {
        level: "high",
        wire: "claude-sonnet-5-5-high",
      },
    ],
  },
];
const retired = new Set([
  "gemini-3.5-flash",
  "gemini-3.5-flash-extra-low",
  "gemini-3.5-flash-low",
  "gemini-3.5-flash-medium",
  "gemini-3.5-flash-high",
  "gemini-3-flash-agent",
  "gemini-2.5-pro",
]);
export function resolveCodexModel(model: string, effort?: string): Variant | undefined {
  const name = model
    .trim()
    .replace(/^models\//, "")
    .toLowerCase();
  if (retired.has(name) || /(?:^|[-_])disabled(?:$|[-_])/.test(name))
    throw new Error("Antigravity model is retired or disabled in the pinned reference catalog");
  const definition = CODEX_CATALOG.find((entry) => entry.id === name);
  if (!definition) return undefined;
  if (definition.variants.length === 1) return definition.variants[0];
  if (!definition.variants.length)
    return definition.wire ? { level: "", wire: definition.wire } : undefined;
  let level = definition.defaultLevel;
  if (effort !== undefined) {
    level = ["none", "off", "minimal", "low"].includes(effort)
      ? "low"
      : ["high", "xhigh", "max", "ultra"].includes(effort)
        ? "high"
        : "medium";
    if (
      level === "high" &&
      effort !== "high" &&
      definition.variants.some((item) => item.level === "xhigh")
    )
      level = "xhigh";
  }
  return (
    definition.variants.find((item) => item.level === level) ??
    definition.variants.find((item) => item.level === definition.defaultLevel)
  );
}
export function codexModelBaseName(displayName: string): string {
  return displayName
    .replace(
      /\s*(?:\((?:extra[- ]?)?(?:low|medium|high|xhigh|minimal|thinking)\)|\s+(?:extra[- ]?)?(?:low|medium|high|xhigh|minimal))\s*$/i,
      "",
    )
    .trim();
}
export function codexThinking(
  model: string,
  wire: string,
  effort?: string,
): { thinkingLevel?: string; thinkingBudget?: number; includeThoughts?: boolean } | undefined {
  const variant = resolveCodexModel(model, effort);
  if (
    wire === "gemini-3.8-flash-tiered" ||
    CODEX_CATALOG.some((item) => item.id.startsWith("gemini-4-") && item.wire === wire)
  ) {
    const config: { thinkingLevel: string; includeThoughts?: boolean } = {
      thinkingLevel: (variant?.level || (effort === "off" ? "low" : effort) || "low").toUpperCase(),
    };
    if (/^(1|true|yes|on)$/i.test(process.env.ANTIGRAVITY_EXPOSE_THOUGHTS || ""))
      config.includeThoughts = true;
    return config;
  }
  if (variant?.budget) return { thinkingBudget: variant.budget, includeThoughts: true };
  return undefined;
}
