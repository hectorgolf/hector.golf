export type FormatForPrintingOptions = { width?: number; indent?: number };

/**
 * Format a string or an array of strings for printing at a given column width and indent.
 *
 * @param text The string or array of strings to format.
 * @param formattingOptions An object containing formatting options.
 * @returns A string with the formatted text.
 */
export function formatForPrinting(text: string | string[], formattingOptions?: FormatForPrintingOptions): string {
    const options = { width: 100, indent: 4, ...formattingOptions };
    if (typeof text === "string") {
        return formatForPrinting(text.split("\n\n"), options);
    }
    if (!Array.isArray(text)) {
        throw new Error(
            `formatForPrinting() was called with an invalid argument: expected a string or an array of strings, but got ${typeof text}`
        );
    }
    const linePrefix = " ".repeat(options.indent);
    const lines: string[] = [];
    for (const paragraph of text) {
        if (lines.length > 0) {
            // Add a blank line between paragraphs.
            lines.push("");
        }
        let currentLine = "";
        const words = paragraph.replace(/\s+/, " ").split(" ");
        for (const word of words) {
            if (currentLine.length + word.length + 1 > options.width - options.indent) {
                // If the current line is too long, add it to the lines array and start a new line.
                lines.push(linePrefix + currentLine);
                currentLine = word;
            } else {
                // Otherwise, add the word to the current line.
                if (currentLine.length > 0) {
                    currentLine += " ";
                }
                currentLine += word;
            }
        }
        if (currentLine.length > 0) {
            lines.push(linePrefix + currentLine);
        }
    }
    return lines.join("\n");
}
