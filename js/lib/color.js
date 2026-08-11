// Validated categorical palette (8 slots), fixed order — see dataviz skill.
// Light/dark hex pairs; identity is always reinforced by a text label alongside
// the swatch, never by hue alone.
export const PALETTE = [
  { name: "blue", light: "#2a78d6", dark: "#3987e5" },
  { name: "aqua", light: "#1baf7a", dark: "#199e70" },
  { name: "yellow", light: "#eda100", dark: "#c98500" },
  { name: "green", light: "#008300", dark: "#008300" },
  { name: "violet", light: "#4a3aa7", dark: "#9085e9" },
  { name: "red", light: "#e34948", dark: "#e66767" },
  { name: "magenta", light: "#e87ba4", dark: "#d55181" },
  { name: "orange", light: "#eb6834", dark: "#d95926" },
];

// Beyond the 8 fixed slots, cycle again but mark a tint round so repeats are
// visually distinguishable at a glance (still backed by text labels everywhere).
export function colorForIndex(index) {
  const slot = PALETTE[index % PALETTE.length];
  const round = Math.floor(index / PALETTE.length);
  return { ...slot, round };
}

export function nextPaletteSlot(existingCategories) {
  const used = new Set(existingCategories.map((c) => c.colorIndex));
  let i = 0;
  while (used.has(i)) i++;
  return i;
}

export function isDarkMode() {
  const override = document.documentElement.getAttribute("data-theme");
  if (override === "dark") return true;
  if (override === "light") return false;
  return typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// The color a category's swatch/mark should render as right now — dark mode
// uses its own validated steps, not an automatic hue flip.
export function catColor(colorIndex) {
  const slot = colorForIndex(colorIndex);
  return isDarkMode() ? slot.dark : slot.light;
}
