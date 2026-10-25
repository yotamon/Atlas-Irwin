import type { SocialPlatformPackage } from "@/lib/marketing/platform-packages";
import type { ReleaseVisualLayoutId, ReleaseVisualMessageIntent } from "@/lib/marketing/release-visual";
import type { VisualBrandDna } from "@/lib/brand/visual-brand-dna";

export type ReleaseVisualRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ReleaseVisualLayoutPlan = {
  canvas: { width: number; height: number };
  safeArea: ReleaseVisualRect;
  background: ReleaseVisualRect;
  artwork: ReleaseVisualRect;
  textArea: ReleaseVisualRect;
  badgeArea: ReleaseVisualRect | null;
  align: "left" | "center";
  textOnArtwork: boolean;
};

function rect(x: number, y: number, width: number, height: number): ReleaseVisualRect {
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.max(0, width)),
    height: Math.round(Math.max(0, height)),
  };
}

function safeArea(target: SocialPlatformPackage) {
  const left = target.width * target.safeArea.leftPercent / 100;
  const right = target.width * target.safeArea.rightPercent / 100;
  const top = target.height * target.safeArea.topPercent / 100;
  const bottom = target.height * target.safeArea.bottomPercent / 100;
  return rect(left, top, target.width - left - right, target.height - top - bottom);
}

function contain(input: {
  box: ReleaseVisualRect;
  sourceWidth: number;
  sourceHeight: number;
  maxWidth?: number;
  maxHeight?: number;
}) {
  const sourceWidth = Math.max(1, input.sourceWidth);
  const sourceHeight = Math.max(1, input.sourceHeight);
  const maxWidth = Math.min(input.box.width, input.maxWidth ?? input.box.width);
  const maxHeight = Math.min(input.box.height, input.maxHeight ?? input.box.height);
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return rect(
    input.box.x + (input.box.width - width) / 2,
    input.box.y + (input.box.height - height) / 2,
    width,
    height,
  );
}

export function releaseVisualLayoutPlan(input: {
  layout: ReleaseVisualLayoutId;
  target: SocialPlatformPackage;
  sourceWidth?: number | null;
  sourceHeight?: number | null;
}): ReleaseVisualLayoutPlan {
  const target = input.target;
  const safe = safeArea(target);
  const sourceWidth = Math.max(1, input.sourceWidth ?? 1);
  const sourceHeight = Math.max(1, input.sourceHeight ?? 1);
  const background = rect(0, 0, target.width, target.height);
  const gap = Math.max(28, Math.round(target.width * 0.045));

  if (input.layout === "editorial_split") {
    const vertical = target.height / target.width >= 1.45;
    if (vertical) {
      const artworkBox = rect(safe.x, safe.y, safe.width, safe.height * 0.6);
      const artwork = contain({
        box: artworkBox,
        sourceWidth,
        sourceHeight,
        maxWidth: safe.width * 0.88,
        maxHeight: artworkBox.height,
      });
      const textY = Math.max(artwork.y + artwork.height + gap, safe.y + safe.height * 0.59);
      return {
        canvas: { width: target.width, height: target.height },
        safeArea: safe,
        background,
        artwork,
        textArea: rect(safe.x, textY, safe.width, safe.y + safe.height - textY),
        badgeArea: rect(safe.x, textY, safe.width * 0.62, Math.min(110, safe.height * 0.1)),
        align: "left",
        textOnArtwork: false,
      };
    }
    const artWidth = safe.width * 0.56;
    const artworkBox = rect(safe.x, safe.y, artWidth, safe.height);
    const artwork = contain({ box: artworkBox, sourceWidth, sourceHeight });
    const textX = safe.x + artWidth + gap;
    return {
      canvas: { width: target.width, height: target.height },
      safeArea: safe,
      background,
      artwork,
      textArea: rect(textX, safe.y, safe.x + safe.width - textX, safe.height),
      badgeArea: rect(textX, safe.y, safe.x + safe.width - textX, Math.min(100, safe.height * 0.14)),
      align: "left",
      textOnArtwork: false,
    };
  }

  if (input.layout === "full_bleed") {
    const textHeight = Math.min(safe.height * 0.36, target.height * 0.34);
    return {
      canvas: { width: target.width, height: target.height },
      safeArea: safe,
      background,
      artwork: background,
      textArea: rect(safe.x, safe.y + safe.height - textHeight, safe.width, textHeight),
      badgeArea: rect(safe.x, safe.y, Math.min(safe.width * 0.7, 620), Math.min(110, safe.height * 0.1)),
      align: "left",
      textOnArtwork: true,
    };
  }

  if (input.layout === "minimal_frame") {
    const textHeight = target.height / target.width >= 1.45 ? safe.height * 0.25 : safe.height * 0.3;
    const artBox = rect(safe.x, safe.y, safe.width, safe.height - textHeight - gap);
    return {
      canvas: { width: target.width, height: target.height },
      safeArea: safe,
      background,
      artwork: contain({
        box: artBox,
        sourceWidth,
        sourceHeight,
        maxWidth: artBox.width * 0.94,
        maxHeight: artBox.height * 0.94,
      }),
      textArea: rect(safe.x, artBox.y + artBox.height + gap, safe.width, textHeight),
      badgeArea: null,
      align: "center",
      textOnArtwork: false,
    };
  }

  const vertical = target.height / target.width >= 1.45;
  const textHeight = vertical ? safe.height * 0.27 : safe.height * 0.28;
  const artBox = rect(safe.x, safe.y, safe.width, safe.height - textHeight - gap);
  return {
    canvas: { width: target.width, height: target.height },
    safeArea: safe,
    background,
    artwork: contain({
      box: artBox,
      sourceWidth,
      sourceHeight,
      maxWidth: vertical ? artBox.width * 0.86 : artBox.width * 0.75,
      maxHeight: artBox.height * 0.94,
    }),
    textArea: rect(safe.x, artBox.y + artBox.height + gap, safe.width, textHeight),
    badgeArea: null,
    align: "center",
    textOnArtwork: false,
  };
}

function scoreLayout(input: {
  layout: ReleaseVisualLayoutId;
  target: SocialPlatformPackage;
  brand: VisualBrandDna | null;
  messageIntent: ReleaseVisualMessageIntent;
}) {
  let score = 0;
  const vertical = input.target.aspectRatio === "9:16";
  if (input.layout === "cover_focus") score += vertical ? 8 : 6;
  if (input.layout === "minimal_frame") score += 5;
  if (input.layout === "editorial_split") score += input.messageIntent === "clean" ? 2 : 7;
  if (input.layout === "full_bleed") score += input.messageIntent === "clean" ? 1 : 3;

  if (input.brand) {
    if (input.brand.spectrum.minimalMaximal <= 0.42 && input.layout === "minimal_frame") score += 6;
    if (input.brand.spectrum.minimalMaximal >= 0.68 && input.layout === "editorial_split") score += 3;
    if (/negative|space|sparse|restrain/i.test(input.brand.composition.negativeSpace) && input.layout === "minimal_frame") score += 4;
    if (/full|bleed|edge|immers/i.test(input.brand.composition.preferredFraming.join(" ")) && input.layout === "full_bleed") score += 4;
    if (/editorial|asym|split/i.test(input.brand.composition.focalStrategy) && input.layout === "editorial_split") score += 4;
  }
  return score;
}

export function rankReleaseVisualLayouts(input: {
  target: SocialPlatformPackage;
  brand: VisualBrandDna | null;
  messageIntent: ReleaseVisualMessageIntent;
}) {
  const layouts: ReleaseVisualLayoutId[] = ["cover_focus", "editorial_split", "full_bleed", "minimal_frame"];
  return layouts.toSorted((left, right) =>
    scoreLayout({ ...input, layout: right }) - scoreLayout({ ...input, layout: left })
    || left.localeCompare(right),
  );
}
