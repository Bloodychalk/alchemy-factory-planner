// Small compatibility fixes applied to verified upstream files in memory only.
export function patchSource(name, text) {
  text = text.replaceAll("\r\n", "\n");
  if (name.endsWith("alchemy_state.js")) {
    text = text
      .replace(
        /(\s+init\(\);)(\s+case 'i18n':)/,
        "$1\n                break;$2",
      )
      .replace(
        /(\s+location\.reload\(\);)(\s+case 'settings':)/,
        "$1\n                break;$2",
      );
  }
  if (name.endsWith("alchemy_calc_engine.js")) {
    text = text.replaceAll(
      "if (effectivePrice) {",
      "if (Number.isFinite(effectivePrice) && effectivePrice >= 0) {",
    );
  }
  if (name.endsWith("alchemy_planner_calc.js")) {
    text = text.replace(
      "const PLANNER_LAYOUT_COL_GAP = 280;",
      "const PLANNER_LAYOUT_COL_GAP = 420;",
    );
  }
  text = text.replace(
    /(["'])alchemy_([a-z_]+)_v1\1/g,
    "$1alchemy-factory-planner:reference:v1:$2$1",
  );
  return text.replace(/\blocalStorage\b/g, "referenceStorage");
}
