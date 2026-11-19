export const graphTheme = Object.freeze({
  ink: "#000",
  paper: "#fff",
  mint: "#4ecdc4",
  coral: "#ff6b6b",
  yellow: "#ffe66d",
  border: 4,
  shadow: 6,
  cardWidth: 200,
  header: 38,
  row: 28,
  footer: 32,
  columnGap: 220,
  rowGap: 64,
  font: "Inter, 'Arial Black', 'PingFang SC', 'Microsoft YaHei', sans-serif",
});
const t = graphTheme;
export const overviewThemeCSS = `
.planner-node{width:${t.cardWidth}px!important;background:${t.paper}!important;border:${t.border}px solid ${t.ink}!important;border-radius:0!important;box-shadow:${t.shadow}px ${t.shadow}px 0 ${t.mint}!important;color:${t.ink}}
.planner-node-header{background:${t.yellow}!important;color:${t.ink}!important;border-radius:0!important;border-bottom:${t.border}px solid ${t.ink}!important}
.planner-node-header.heat{background:${t.coral}!important}.planner-node-header.fert{background:${t.mint}!important}
.planner-port-dot{border:2px solid ${t.ink}!important;border-radius:0!important}
.planner-edge-label{background:${t.paper}!important;color:${t.ink}!important;border:2px solid ${t.ink}!important;border-radius:0!important;box-shadow:2px 2px 0 ${t.mint}}
.planner-edge-group{color:${t.ink}!important}.planner-edge-line{stroke-width:2.5;stroke-dasharray:6 5}
`;
export const lineStyle = (value) => (value === "chevron" ? "chevron" : "dash");
