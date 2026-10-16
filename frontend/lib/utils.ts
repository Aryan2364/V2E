import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * tailwind-merge has to be told about the project's own token names.
 *
 * Its default rules treat any unrecognised `text-*` class as a text
 * colour. Our type scale is also in the `text-*` namespace, so without
 * this extension `cn("text-label", "text-text-secondary")` classified
 * both as colours, kept only the last, and silently dropped the font
 * size - every label rendered at the inherited 14px instead of 13px,
 * with no error anywhere.
 *
 * Anything added to the type scale in globals.css must be added here
 * too, or it will be dropped the same way.
 *
 * The shadow and easing names of sections 5.4 and 5.6 have the same
 * problem one namespace over: unregistered, `shadow-card` reads as a
 * shadow COLOUR, so `cn("shadow-lg", "shadow-card")` keeps both and
 * `cn("shadow-card", "shadow-none")` does not cancel. Measured.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      shadow: ["card", "menu", "dialog"],
      ease: ["enter", "exit"],
    },
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "page-title",
            "section",
            "card-heading",
            "body",
            "label",
            "meta",
            "bar-title",
            "bar-label",
            "bar-button",
          ],
        },
      ],
      "text-color": [
        {
          text: ["text-primary", "text-secondary", "text-muted"],
        },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
