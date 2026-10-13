/** One turn of the game: remember, decide, then speak. */
import { GliclassModel, RulesModel, decide, describe, type Decision } from "./decision.ts";
import { speak, type Spoken } from "./dialogue.ts";
import { notes, replay, type Event, type Memory } from "./memory.ts";
import { Ollama } from "./ollama.ts";
import type { Reaction } from "./rules.ts";

export type Mood = "neutral" | "happy" | "annoyed" | "angry" | "scared" | "flinch";

export function mood(m: Memory, r: Reaction): Mood {
  switch (r) {
    case "welcome":
      return "happy";
    case "wary":
    case "refuse":
      return m.fear > 40 ? "scared" : "annoyed";
    case "call_guards":
      return m.fear > 40 ? "scared" : "angry";
    default:
      return m.last === "hit" || m.last === "bump" ? "flinch" : "neutral";
  }
}

export type Settings = {
  /** "gliclass" or "rules" */
  decider: string;
  /** an Ollama model name, or null for authored lines */
  voice: string | null;
};

export type Turn = {
  memory: Memory;
  notes: string[];
  decision: Decision;
  spoken: Spoken;
  mood: Mood;
  /** what the decision model read */
  situation: string;
};

export type Services = { gliclass: GliclassModel; rules: RulesModel; ollama: Ollama };

export const defaultServices = (): Services => ({
  gliclass: new GliclassModel(),
  rules: new RulesModel(),
  ollama: new Ollama(),
});

export async function takeTurn(events: Event[], settings: Settings, s: Services): Promise<Turn> {
  const memory = replay(events);
  const decision = await decide(memory, settings.decider === "gliclass" ? s.gliclass : s.rules, s.rules);
  const spoken = await speak(memory, decision, s.ollama, settings.voice);
  return {
    memory,
    notes: notes(memory),
    decision,
    spoken,
    mood: mood(memory, decision.reaction),
    situation: describe(memory),
  };
}
