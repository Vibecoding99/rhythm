// Best-guess emoji for a category name, used as a starting point for new
// categories and to backfill ones created before emoji existed. Always
// user-editable afterward — this is just a sensible default, not a rule.
const KEYWORD_EMOJI = [
  [["workout", "gym", "exercise", "fitness", "lift", "training", "strength"], "🏋️"],
  [["run", "running", "jog"], "🏃"],
  [["walk", "hike", "hiking"], "🚶"],
  [["yoga", "meditat", "mindful", "stretch"], "🧘"],
  [["read", "book"], "📚"],
  [["study", "school", "homework", "class", "learn", "course"], "📖"],
  [["work", "job", "office"], "💼"],
  [["sleep", "rest", "nap"], "😴"],
  [["food", "eat", "meal", "cook", "dinner", "lunch", "breakfast", "recipe"], "🍽️"],
  [["coffee"], "☕"],
  [["water", "hydrat"], "💧"],
  [["music", "practice", "piano", "guitar", "instrument"], "🎵"],
  [["game", "gaming"], "🎮"],
  [["family", "kid"], "👨‍👩‍👧"],
  [["friend", "social"], "👥"],
  [["clean", "chore", "laundry", "tidy"], "🧹"],
  [["shop"], "🛍️"],
  [["travel", "trip", "vacation", "flight"], "✈️"],
  [["writ", "journal", "blog"], "✍️"],
  [["code", "coding", "program", "dev", "software"], "💻"],
  [["meeting", "call"], "🗓️"],
  [["health", "doctor", "therapy", "medicine", "appointment"], "🩺"],
  [["self care", "selfcare", "bath", "spa", "skincare"], "🛁"],
  [["tv", "movie", "watch", "show", "film"], "📺"],
  [["drive", "commute", "car"], "🚗"],
  [["pet", "dog", "cat"], "🐾"],
  [["garden", "plant"], "🪴"],
  [["art", "draw", "paint", "design", "sketch"], "🎨"],
  [["finance", "money", "budget", "invest", "bill"], "💰"],
];

const DEFAULT_EMOJI = "🏷️";

export function suggestEmoji(name) {
  const n = (name || "").toLowerCase();
  for (const [keywords, emoji] of KEYWORD_EMOJI) {
    if (keywords.some((k) => n.includes(k))) return emoji;
  }
  return DEFAULT_EMOJI;
}
