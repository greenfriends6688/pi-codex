/**
 * fork:dev-watchdog — dev 服务的看门狗（Windows 计划任务每 5 分钟调一次）。
 *
 * 背景：`npm run dev` 会被 OOM 杀掉；原来的计划任务是「一次性 + 前台阻塞」，
 * 只跑过一次、以退出码 1 结束，之后 30141 掉了就再没人管。
 *
 * 设计（踩过的坑都在注释里）：
 * 1. **端口有人监听就立刻退出**（幂等，重复调用无害）。
 * 2. 没人监听时**拉起 dev 并守着他**：dev 死掉（OOM）本进程才退出 —— 于是计划任务的下一次
 *    巡检（≤5 分钟）会再拉一次，形成自愈。任务配置里不要开「并行启动新实例」。
 * 3. 不要用 detached + 立即退出：那种子进程会随调用方的 job 对象关闭被一起杀掉
 *    （在任务计划之外的 shell 里实测必死），dev 根本起不来。
 * 4. dev 的输出写日志文件用 fd 重定向，不用 shell 的 `>`：Windows 上 Node 的参数引号规则
 *    会把 `cmd /c "... > 日志"` 整体当参数，命令静默不执行。
 *
 *   node scripts/dev-watchdog.mjs            # 计划任务入口
 *   node scripts/dev-watchdog.mjs --status   # 只看状态，不动手
 */
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = Number(process.env.PIWEB_PORT || 30141);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const statusOnly = process.argv.includes("--status");
const stamp = () => new Date().toLocaleString("zh-CN");

const isListening = () => new Promise((resolve) => {
  const socket = createConnection({ host: "127.0.0.1", port: PORT });
  const done = (value) => { socket.destroy(); resolve(value); };
  socket.setTimeout(1000);
  socket.on("connect", () => done(true));
  socket.on("timeout", () => done(false));
  socket.on("error", () => done(false));
});

if (await isListening()) {
  console.log(`[watchdog] ${stamp()}  ${PORT} 在跑，跳过`);
  process.exit(0);
}
if (statusOnly) {
  console.log(`[watchdog] ${stamp()}  ${PORT} 没在跑（--status 模式，不拉起）`);
  process.exit(1);
}

const logFile = join(process.env.TEMP ?? ".", "pi-dev.log");
const logFd = openSync(logFile, "a");
console.log(`[watchdog] ${stamp()}  ${PORT} 没在跑，拉起 dev（日志 ${logFile}）`);

const child = spawn("cmd.exe", ["/c", "npm.cmd", "run", "dev:clean"], {
  cwd: ROOT,
  stdio: ["ignore", logFd, logFd],
  windowsHide: true,
});

let announced = false;
const announceWhenReady = setInterval(async () => {
  if (announced) return;
  if (await isListening()) {
    announced = true;
    clearInterval(announceWhenReady);
    console.log(`[watchdog] ${stamp()}  ${PORT} 已就绪（dev pid ${child.pid}），本进程会一直守着它`);
  }
}, 2000);

child.on("exit", (code, signal) => {
  clearInterval(announceWhenReady);
  console.log(`[watchdog] ${stamp()}  dev 退出（code=${code} signal=${signal ?? "-"}）${announced ? "" : "，且没监听到端口"}`);
  // 非零退出 = 没能带来一个可用的 dev（例如端口 TIME_WAIT），让任务历史里看得见
  process.exit(announced ? 0 : 1);
});
