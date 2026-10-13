/**
 * Authored lines for every decision. They are what Mira says when no
 * language model is running, so the game always has something to show.
 */
import type { Memory } from "./memory.ts";
import type { Price, Reaction } from "./rules.ts";

export function authoredLine(m: Memory, r: Reaction, price: Price | null): string {
  const c = m.counts;
  if (m.last === null) return "Fresh apples! Two coins each.";
  if (m.last === "buy" && r !== "call_guards") {
    switch (price) {
      case "1 coin":
        return c.help >= 2 ? "For you? One coin. You've carried enough crates." : "One coin, friend.";
      case "3 coins":
        return c.steal > 0 ? "Three coins. For you. I remember the last ones." : "Three coins. For you.";
      case "no sale":
        return "I'm not selling to you.";
      default:
        return "Two coins, same as anyone.";
    }
  }
  if (m.last === "say") {
    switch (r) {
      case "welcome":
        return "Always good to see you. What can I do for you?";
      case "serve":
        return "Mm. Anything else? Apples are two coins.";
      case "wary":
        return "Words are cheap. I remember what you did.";
      case "refuse":
        return "I've nothing to say to you.";
      case "call_guards":
        return "Get away from me! Guards!";
    }
  }
  switch (r) {
    case "call_guards":
      return m.fear > 60 ? "Stay back! Guards! GUARDS!" : "What is wrong with you?! Guards!";
    case "refuse":
      if (m.last === "steal") return `That's ${c.steal} apples. I'm not selling to you.`;
      return "I'm not dealing with you.";
    case "wary":
      if (m.last === "bump" && m.brokenApologies > 0) return "Again? You said sorry yesterday.";
      if (m.last === "bump") return `That's ${c.bump} times you've walked into me. Watch it.`;
      if (m.last === "steal") return c.steal > 1 ? `That's ${c.steal} apples. I'm keeping count.` : "Put that back. I saw that.";
      if (m.last === "hit") return "Don't you dare come closer.";
      if (m.last === "apologise") return m.brokenApologies >= 2 ? "You said that last time. And the time before." : "You said sorry yesterday too.";
      if (m.fear > 40) return "(She hurries to the far side of the stall.)";
      return "What do you want?";
    case "welcome":
      if (m.last === "bump") return "Oof! Oh, it's you. No harm done.";
      if (m.last === "help") return m.trust > 40 ? "You're a good one. Here, take an apple, no charge." : "Thank you, dear. Come by tomorrow.";
      return "Morning! I saved you the good apples.";
    case "serve":
      if (m.last === "bump") return "Oi, careful.";
      if (m.last === "help") return "Thank you. My back thanks you too.";
      if (m.last === "apologise") return "…Fine. Apology accepted.";
      return "Fresh apples! Two coins each.";
  }
}
