import { parseSlowTestAllowances, reportTestRun } from "../lib/tooling/src/test-report";
const xml = await Bun.file(new URL("./each.junit.xml", import.meta.url)).text();
const allowances = parseSlowTestAllowances({thresholdMs:{SLOW:1.5, XSLOW:10, DANGER:1000},tests:{}});
console.log(JSON.stringify(reportTestRun({mode:"changed",exitCode:1,xml,output:""},allowances),null,2));
