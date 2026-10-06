import { formatIssues, validateContent } from "./validate-content";
import { loadContent, REPO_ROOT } from "./load-data";

function main(): number {
  const input = loadContent();
  const { issues, cards, enhancements, enemies, acts, relics, events, classes } = validateContent(input);

  if (issues.length > 0) {
    console.error(`\n[content-validator] 校验失败：${issues.length} 个问题\n`);
    console.error(formatIssues(issues));
    console.error("");
    return 1;
  }

  console.log(
    `[content-validator] 通过 · 卡牌 ${cards.length} · 强化 ${enhancements.length} · 敌人 ${enemies.length} · 遗物 ${relics.length} · 事件 ${events.length} · 职业 ${classes.length} · 关卡 ${acts.length} · i18n ${Object.keys(input.i18n).length} 条`,
  );
  console.log(`  root: ${REPO_ROOT}`);
  return 0;
}

process.exitCode = main();