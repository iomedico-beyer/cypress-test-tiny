/*
 * Sweeps the spec bundle size and records, for every size, whether the run finished or stalled in
 * cy.visit(). The loop has to live outside Cypress: a stalled run never ends by itself, so each
 * run is watched and killed.
 *
 * How a run is classified: the spec prints "visiting ..." through a task right before the visit
 * and "visit returned" right after. Any such line rearms a watchdog (the test body runs twice,
 * because the first visit reloads the AUT). Silence past that watchdog means the visit stalled.
 *
 *    node sweep.js                                  1..80 MB in steps of 1
 *    SWEEP_START=15 SWEEP_END=30 node sweep.js      a range
 *    SWEEP_SIZES=5,10,15,16,17 node sweep.js        exactly these sizes
 *    SWEEP_TWO_BYTE=1 node sweep.js                 generated with --two-byte
 *
 * Results are appended to sweep-results.csv after every size, and sizes already in that file are
 * skipped, so the sweep can be interrupted and resumed. Each run's full output is kept under
 * sweep-logs/.
 */
const { spawn, execFileSync } = require("child_process")
const fs = require("fs")
const path = require("path")

/* a healthy visit answers in about a second; this only has to outlast a slow one */
const VISIT_TIMEOUT_MS = Number(process.env.SWEEP_VISIT_TIMEOUT || 90) * 1000
/* bundling 80 MB takes minutes, so the first marker gets a wide budget of its own */
const BUNDLE_TIMEOUT_MS = Number(process.env.SWEEP_BUNDLE_TIMEOUT || 1500) * 1000

const sizes = []
if (process.env.SWEEP_SIZES) {
   for (const part of process.env.SWEEP_SIZES.split(",")) {
      const mb = Number(part.trim())
      if (Number.isFinite(mb) && mb > 0) sizes.push(mb)
   }
} else {
   const start = Number(process.env.SWEEP_START || 1)
   const end = Number(process.env.SWEEP_END || 80)
   const step = Number(process.env.SWEEP_STEP || 1)
   for (let mb = start; mb <= end; mb += step) sizes.push(mb)
}

const resultsPath = path.join(__dirname, "sweep-results.csv")
const logsDir = path.join(__dirname, "sweep-logs")

fs.mkdirSync(logsDir, { recursive: true })
if (!fs.existsSync(resultsPath)) fs.writeFileSync(resultsPath, "megabytes,result,seconds\n")

const done = new Map()
for (const line of fs.readFileSync(resultsPath, "utf8").split(/\r?\n/).slice(1)) {
   const [mb, result] = line.split(",")
   if (mb) done.set(Number(mb), result)
}

const stamp = () => new Date().toTimeString().slice(0, 8)

/*
 * Kills the whole process tree of the run. The shell is the parent of the Cypress process, which
 * is the parent of Chrome, so /T reaches all of them. Anything that still appeared after this run
 * started is swept afterwards - a browser the user opened meanwhile would fall into that window,
 * which is the price of not leaving half a gigabyte of hung Chrome behind on every stalled size.
 */
function killTree(pid, startedAt) {
   try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" })
   } catch {
      /* already gone */
   }
   const iso = new Date(startedAt).toISOString()
   const ps = `Get-Process -Name Cypress,chrome -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt [datetime]'${iso}' } | Stop-Process -Force -ErrorAction SilentlyContinue`
   try {
      execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore" })
   } catch {
      /* nothing left to kill */
   }
}

function runOnce(mb) {
   return new Promise((resolve) => {
      const startedAt = Date.now()
      const logPath = path.join(logsDir, `sweep-${String(mb).padStart(3, "0")}mb.log`)
      const logStream = fs.createWriteStream(logPath)
      const env = { ...process.env }
      /* set by some editors; it makes the Cypress binary crash with 0xC000001D */
      delete env.ELECTRON_RUN_AS_NODE

      const child = spawn("npx cypress run", { shell: true, cwd: __dirname, env })
      let timer = null
      let settled = false

      const finish = (result) => {
         if (settled) return
         settled = true
         if (timer) clearTimeout(timer)
         logStream.end()
         resolve({ result, seconds: Math.round((Date.now() - startedAt) / 1000) })
      }
      const arm = (ms, result) => {
         if (timer) clearTimeout(timer)
         timer = setTimeout(() => {
            killTree(child.pid, startedAt)
            finish(result)
         }, ms)
      }

      arm(BUNDLE_TIMEOUT_MS, "bundle-timeout")

      const onData = (buf) => {
         const text = buf.toString()
         logStream.write(text)
         if (text.includes("visiting ...") || text.includes("visit returned")) arm(VISIT_TIMEOUT_MS, "STALLED")
      }
      child.stdout.on("data", onData)
      child.stderr.on("data", onData)
      child.on("exit", (code) => finish(code === 0 ? "passed" : `failed(${code})`))
   })
}

async function main() {
   console.log(`sweep ${sizes.length} sizes: ${sizes.join(", ")} MB`)
   console.log(`visit watchdog ${VISIT_TIMEOUT_MS / 1000}s`)
   for (const mb of sizes) {
      if (done.has(mb)) {
         console.log(`${stamp()}  ${String(mb).padStart(3)} MB  ${done.get(mb)} (already measured, skipped)`)
         continue
      }
      const generate = [path.join(__dirname, "generate-big-module.js"), String(mb), ...(process.env.SWEEP_TWO_BYTE ? ["--two-byte"] : [])]
      execFileSync(process.execPath, generate, { stdio: "ignore" })
      process.stdout.write(`${stamp()}  ${String(mb).padStart(3)} MB  running ... `)
      const { result, seconds } = await runOnce(mb)
      console.log(`${result} (${seconds}s)`)
      fs.appendFileSync(resultsPath, `${mb},${result},${seconds}\n`)
   }
   console.log("sweep finished, results in sweep-results.csv")
}

main()
