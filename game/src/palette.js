// The look plan, in one place: a desert depot at dusk. Warm sand and rust
// against dark steel, one ember accent for the attackers and one teal accent
// for the defenders. The same names are the CSS custom properties in
// index.html, so the HUD and the 3D scene share one palette.
export const PALETTE = {
  canvas: '#221710', // fog and sky base
  ground: '#6b543a', // packed sand
  surface: '#3a2c1e', // concrete walls
  steel: '#2c323a', // dark steel, containers
  rust: '#a4552a', // rusted containers
  crate: '#7a5c33', // wooden crates
  ink: '#f2ead8', // warm off-white
  muted: '#a89880', // sand muted
  accent: '#ff8c2e', // ember orange (attackers, highlights)
  ember: '#e5484d', // attacker team red
  teal: '#2fb3a3', // defender team teal
  gold: '#f0c040', // money, awards
};

export function shade(name) {
  return PALETTE[name];
}
