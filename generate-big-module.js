/*
 * Generates ./big/, a module graph of plain JavaScript whose only purpose is to make the spec
 * bundle large. Size in megabytes as the first argument, 45 by default.
 *
 * It is generated rather than committed so this repository stays small; run "npm run generate"
 * before "npm run cypress:run".
 */
const fs = require("fs")
const path = require("path")

const megabytes = Number(process.argv[2] || 45)
const MODULES = 300
const dir = path.join(__dirname, "big")
const name = (m) => "mod" + String(m).padStart(4, "0")

const targetPerModule = Math.ceil((megabytes * 1024 * 1024) / MODULES)
const padding = "x".repeat(200)

fs.rmSync(dir, { recursive: true, force: true })
fs.mkdirSync(dir, { recursive: true })

for (let m = 0; m < MODULES; m++) {
   const parts = []
   let size = 0
   for (let i = 0; size < targetPerModule; i++) {
      const fn = `export function fn${m}_${i}(value) {\n   return "module ${m} function ${i} " + value + " ${padding}"\n}\n`
      parts.push(fn)
      size += fn.length
   }
   fs.writeFileSync(path.join(dir, name(m) + ".js"), parts.join(""))
}

/*
 * Every module is imported as a namespace and put into an array the spec reads, so that no part
 * of the graph can be dropped as unused. "megabytes" rides along so the spec can name the size it
 * was built with in the runner output.
 */
const imports = []
const names = []
for (let m = 0; m < MODULES; m++) {
   imports.push(`import * as ${name(m)} from "./${name(m)}.js"`)
   names.push(name(m))
}
fs.writeFileSync(
   path.join(dir, "index.js"),
   imports.join("\n") + `\n\nexport const megabytes = ${megabytes}\n\nexport const modules = [\n   ` + names.join(",\n   ") + ",\n]\n",
)

const bytes = fs.readdirSync(dir).reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0)
console.log(`generated ${MODULES} modules in ./big, ${(bytes / 1024 / 1024).toFixed(1)} MB of JavaScript`)
