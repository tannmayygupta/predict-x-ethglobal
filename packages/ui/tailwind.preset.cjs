/**
 * Tailwind preset shared by the extension and the dashboard. Every value is a design token (UI_REFERENCE
 * section 1), so components cannot hard-code a color, radius or font size. Sizes are px, not rem, because the
 * overlay sits on x.com whose root font size is not ours. Preflight is off: the overlay lives in a shadow root
 * with its own reset, and the dashboard adds its own.
 */
const px = (n) => `${n}px`;

module.exports = {
  corePlugins: { preflight: false },
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      ink: "var(--px-ink)",
      ink2: "var(--px-ink-2)",
      ink3: "var(--px-ink-3)",
      rule: "var(--px-rule)",
      text: "var(--px-text)",
      mute: "var(--px-mute)",
      amber: "var(--px-amber)",
      "amber-ink": "var(--px-amber-ink)",
      yes: "var(--px-yes)",
      no: "var(--px-no)",
      page: "var(--px-page)",
    },
    spacing: {
      0: "0px", px: "1px", 0.5: px(2), 1: px(4), 1.5: px(6), 2: px(8), 3: px(12), 4: px(16), 5: px(20), 6: px(24),
      8: px(32), 10: px(40), 12: px(48), 16: px(64),
    },
    fontSize: {
      12: [px(12), px(16)], 13: [px(13), px(18)], 14: [px(14), px(20)], 16: [px(16), px(22)],
      20: [px(20), px(26)], 28: [px(28), px(34)], 40: [px(40), px(46)],
    },
    fontFamily: { display: ["var(--px-font-display)"], body: ["var(--px-font-body)"] },
    borderRadius: {
      none: "0px", input: "var(--px-r-input)", button: "var(--px-r-button)", card: "var(--px-r-card)", bar: px(5), full: "9999px",
    },
    boxShadow: { card: "var(--px-shadow)", none: "none" },
    extend: {
      transitionDuration: { fast: "var(--px-t-fast)", card: "var(--px-t-card)" },
      zIndex: { overlay: "var(--px-z-overlay)" },
    },
  },
};
