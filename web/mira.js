// Mira at her apple stall, drawn in SVG. Her face and posture follow her mood,
// so you can read how she feels before you read what she says.

const SKIN = "#d9a47a";
const HAIR = "#3b2a20";
const APRON = "#2f5a4c";
const SHIRT = "#e9dcc4";
const INK = "#1d1c19";
const ACCENT = "#a8471f";

const stroke = `stroke="${INK}" stroke-width="2.2" stroke-linecap="round" fill="none"`;

const FACES = {
  happy: `
    <path d="M-11,-4 q4,-5 8,0" ${stroke}/>
    <path d="M3,-4 q4,-5 8,0" ${stroke}/>
    <path d="M-8,8 q8,8 16,0" ${stroke}/>
    <circle cx="-14" cy="4" r="3.5" fill="#e48a6a" opacity="0.55"/>
    <circle cx="14" cy="4" r="3.5" fill="#e48a6a" opacity="0.55"/>`,
  annoyed: `
    <path d="M-13,-10 l9,3" ${stroke}/>
    <path d="M13,-10 l-9,3" ${stroke}/>
    <path d="M-11,-2 h7" ${stroke}/>
    <path d="M4,-2 h7" ${stroke}/>
    <path d="M-6,10 h12" ${stroke}/>`,
  angry: `
    <path d="M-13,-12 l10,6" ${stroke}/>
    <path d="M13,-12 l-10,6" ${stroke}/>
    <circle cx="-7" cy="-1" r="2.2" fill="${INK}"/>
    <circle cx="7" cy="-1" r="2.2" fill="${INK}"/>
    <path d="M-8,13 q8,-7 16,0" ${stroke}/>
    <circle cx="-14" cy="5" r="3.5" fill="${ACCENT}" opacity="0.45"/>
    <circle cx="14" cy="5" r="3.5" fill="${ACCENT}" opacity="0.45"/>`,
  scared: `
    <path d="M-12,-11 q4,-4 8,-1" ${stroke}/>
    <path d="M12,-11 q-4,-4 -8,-1" ${stroke}/>
    <circle cx="-7" cy="-2" r="4" fill="#fff" stroke="${INK}" stroke-width="1.5"/>
    <circle cx="7" cy="-2" r="4" fill="#fff" stroke="${INK}" stroke-width="1.5"/>
    <circle cx="-7" cy="-2" r="1.6" fill="${INK}"/>
    <circle cx="7" cy="-2" r="1.6" fill="${INK}"/>
    <ellipse cx="0" cy="11" rx="3.5" ry="4.5" fill="${INK}"/>
    <path d="M17,-14 q3,5 0,8 q-3,-3 0,-8" fill="#7aaed6"/>`,
  flinch: `
    <path d="M-11,-2 l6,-3 M-11,-6 l6,3" ${stroke}/>
    <path d="M11,-2 l-6,-3 M11,-6 l-6,3" ${stroke}/>
    <path d="M-7,10 l3,-2 l3,2 l3,-2 l3,2" ${stroke}/>`,
  neutral: `
    <circle cx="-7" cy="-2" r="2.2" fill="${INK}"/>
    <circle cx="7" cy="-2" r="2.2" fill="${INK}"/>
    <path d="M-6,9 q6,4 12,0" ${stroke}/>`,
};

export function miraSvg(mood = "neutral") {
  // lean back when scared, turn a little when annoyed
  const shift = mood === "scared" ? 26 : mood === "flinch" ? 8 : 0;
  const tilt = mood === "scared" ? 8 : mood === "annoyed" ? -6 : mood === "flinch" ? 10 : 0;
  const awning = Array.from(
    { length: 8 },
    (_, i) =>
      `<path d="M${10 + i * 25},14 h25 v18 q-12.5,9 -25,0 z" fill="${i % 2 ? "#f3efe6" : ACCENT}" opacity="${i % 2 ? 1 : 0.85}"/>`,
  ).join("");
  const apples = [30, 48, 66, 152, 170, 188]
    .map((x, i) => {
      const y = 108 - (i % 3 === 1 ? 6 : 0);
      return `<circle cx="${x}" cy="${y}" r="8" fill="#c2412d"/><path d="M${x},${y - 8} q2,-4 5,-4" stroke="#4f7a32" stroke-width="2" fill="none"/>`;
    })
    .join("");
  const extra =
    mood === "angry"
      ? `<path d="M26,-26 l5,-5 m-1,9 l7,-2 m-12,-9 l1,-7" stroke="${ACCENT}" stroke-width="2.2" stroke-linecap="round"/>`
      : mood === "annoyed"
        ? `<path d="M24,-24 q4,4 0,8 q4,4 0,8" stroke="${INK}" stroke-width="1.6" fill="none"/>`
        : "";
  return `<svg viewBox="0 0 220 146" role="img" aria-label="Mira looks ${mood}">
    ${awning}
    <rect x="10" y="8" width="200" height="7" fill="${INK}"/>
    <g class="mira" style="transform: translate(${110 + shift}px, 68px) rotate(${tilt}deg) scale(1.35)">
      <path d="M-30,60 q0,-34 30,-34 q30,0 30,34 z" fill="${SHIRT}"/>
      <path d="M-18,60 v-24 q18,-8 36,0 v24 z" fill="${APRON}"/>
      <circle cx="0" cy="0" r="22" fill="${SKIN}"/>
      <path d="M-23,-2 q0,-26 23,-26 q23,0 23,26 q-6,-14 -23,-16 q-17,2 -23,16 z" fill="${HAIR}"/>
      <circle cx="0" cy="-27" r="9" fill="${HAIR}"/>
      ${FACES[mood] ?? FACES.neutral}
      ${extra}
    </g>
    <rect x="10" y="112" width="200" height="34" fill="#b98b5e"/>
    <rect x="10" y="112" width="200" height="5" fill="#8f6640"/>
    ${apples}
  </svg>`;
}
