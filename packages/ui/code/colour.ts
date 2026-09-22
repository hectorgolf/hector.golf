/**
 * Colour arithmetic, shared by the site and the admin.
 *
 * Here rather than in either app because both draw the same tee dots against
 * the same tokens — `hector.css` is imported by both — and a second copy of a
 * contrast calculation is a second answer to "is this visible", which is the
 * sort of thing that goes wrong in only one of two places.
 *
 * WCAG's definitions, unchanged: a hex is parsed the way CSS parses one, and
 * the ratio is the one the guidelines specify for deciding whether something
 * can be seen against what is behind it.
 */

export type Rgb = { r: number; g: number; b: number };

/** `#abc` and `#aabbcc`, the two spellings CSS allows for an opaque hex. */
export function parseHex(hex: string): Rgb {
    const digits = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
    if (!digits) throw new Error(`Not a hex colour: ${hex}`);
    const full =
        digits.length === 3
            ? digits
                  .split("")
                  .map((c) => c + c)
                  .join("")
            : digits;
    return {
        r: Number.parseInt(full.slice(0, 2), 16),
        g: Number.parseInt(full.slice(2, 4), 16),
        b: Number.parseInt(full.slice(4, 6), 16),
    };
}

export function toHex({ r, g, b }: Rgb): string {
    const toHexChannel = (value: number) => value.toString(16).padStart(2, "0");
    return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}`;
}

/* IEC 61966-2-1 sRGB transfer-function constants. */
const SRGB_LOW_THRESHOLD = 0.04045;
const SRGB_LINEAR_LOW_THRESHOLD = 0.0031308;
const SRGB_SLOPE = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_GAMMA = 2.4;

/**
 * Converts an 8-bit sRGB channel to linear light.
 *
 * sRGB stores dark values with a linear segment and brighter values with a
 * gamma-encoded segment. Relative luminance must use these linear-light
 * values, rather than the channel values as stored in CSS.
 *
 * @param value An 8-bit sRGB channel value (0..255).
 * @returns The corresponding linear-light value.
 */
function linearize(value: number): number {
    // Normalize the 8-bit sRGB channel before applying the transfer curve.
    const channel = value / 255;
    if (channel <= SRGB_LOW_THRESHOLD) {
        // The dark part of sRGB is already linear; divide by the encoding
        // slope to recover the corresponding linear-light value.
        return channel / SRGB_SLOPE;
    } else {
        // For brighter values, undo the sRGB encoding in two steps:
        // 1. Remove the offset and scale applied to the normalized channel.
        // 2. Raise the result to the encoding gamma to recover linear light.
        return ((channel + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_GAMMA;
    }
}

/**
 * Converts a linear-light channel back to an 8-bit sRGB channel value.
 *
 * @param value A linear-light channel value (0..1).
 * @returns The corresponding 8-bit sRGB channel value (0-255).
 */
function delinearize(value: number): number {
    if (value <= SRGB_LINEAR_LOW_THRESHOLD) {
        // The dark part of sRGB is linear, so undoing it is just the same
        // slope used by linearize(). The final multiplication converts the
        // normalized sRGB channel (0..1) to an 8-bit channel (0..255).
        return 255 * value * SRGB_SLOPE;
    } else {
        // linearize() encodes brighter channels as:
        //   linear = ((srgb + offset) / scale) ** gamma
        // Solve that equation for srgb to reverse the encoding:
        //   srgb = scale * linear ** (1 / gamma) - offset
        // As above, convert the normalized result back to an 8-bit channel.
        return 255 * (SRGB_SCALE * value ** (1 / SRGB_GAMMA) - SRGB_OFFSET);
    }
}

/**
 * Calculate the WCAG relative luminance for a given RGB value.
 *
 * @param r Red channel (0..255).
 * @param g Green channel (0..255).
 * @param b Blue channel (0..255).
 * @returns The relative luminance (0..1).
 */
export function luminance({ r, g, b }: Rgb): number {
    return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Increases relative luminance while preserving linear-RGB channel ratios.
 * The requested increase is reduced when the sRGB gamut has no more headroom.
 * For black, where relative scaling cannot produce light, the requested
 * fraction becomes an equal neutral linear-light value for all three channels.
 *
 * @param rgb An sRGB colour with channel values in the range 0..255.
 * @param increase The requested relative increase as a fraction; `0.2` means
 *     a 20% increase. The actual increase may be smaller at the gamut limit.
 * @returns A gamut-safe sRGB colour with rounded channel values in the range
 *     0..255.
 */
export function increaseLuminance(rgb: Rgb, increase: number): Rgb {
    const channels = [linearize(rgb.r), linearize(rgb.g), linearize(rgb.b)];
    const brightest = Math.max(...channels);
    const requestedScale = 1 + increase;
    const scale = brightest === 0 ? 0 : Math.min(requestedScale, 1 / brightest);
    const adjustedChannels = brightest === 0 ? [increase, increase, increase] : channels.map((channel) => channel * scale);

    return {
        r: Math.round(delinearize(adjustedChannels[0]!)),
        g: Math.round(delinearize(adjustedChannels[1]!)),
        b: Math.round(delinearize(adjustedChannels[2]!)),
    };
}

/**
 * Decreases relative luminance while preserving linear-RGB channel ratios.
 * The requested decrease is limited at black.
 *
 * @param rgb An sRGB colour with channel values in the range 0..255.
 * @param decrease The requested relative decrease as a fraction; `0.2` means
 *     a 20% decrease.
 * @returns A black-safe sRGB colour with rounded channel values in the range
 *     0..255.
 */
export function decreaseLuminance(rgb: Rgb, decrease: number): Rgb {
    const channels = [linearize(rgb.r), linearize(rgb.g), linearize(rgb.b)];
    const scale = Math.max(0, 1 - decrease);

    return {
        r: Math.round(delinearize(channels[0]! * scale)),
        g: Math.round(delinearize(channels[1]! * scale)),
        b: Math.round(delinearize(channels[2]! * scale)),
    };
}

/**
 * Calculate the WCAG contrast ratio between two RGB values. Always returns a
 * value >= 1 whichever way round the pair is given.
 *
 * @param a First RGB colour.
 * @param b Second RGB colour.
 * @returns The contrast ratio (>= 1).
 */
export function contrast(a: Rgb, b: Rgb): number {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (lighter! + 0.05) / (darker! + 0.05);
}
