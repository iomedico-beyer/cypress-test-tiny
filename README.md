# cypress-test-tiny — the first `cy.visit()` hangs forever when the spec bundle is large

Reproduction for a Cypress 16.0.0 regression: the first `cy.visit()` of a spec never returns once
the spec bundle gets large. There is no error and no timeout — `pageLoadTimeout` never fires and the
browser process sits at 0 % CPU, so the run has to be killed. `forceHttp1: true` makes the very same
spec pass.

## Run it

```
npm install
npm run generate                      # writes ./big, about 45 MB of plain JavaScript
npx cypress run
```

`./big` is generated rather than committed so this repository stays small, which is why a fresh
clone has nothing to bundle yet.

Bundling takes a couple of minutes the first time, and that part is expected: node sits at 100 % CPU
while webpack works through 45 MB. Then the run prints `bundle: 45 MB in 300 modules` and
`visiting ...` and stops there — measured for 4 minutes against a default `pageLoadTimeout` of 60 s,
with the browser at 0.03 s CPU over a 20 s sample.

The same run on the legacy network path passes in seconds:

```
npx cypress run --config forceHttp1=true
```

**It has to be Chrome.** `defaultBrowser: 'chrome'` is pinned in `cypress.config.js`, so the plain
command above is enough. Under Electron or Firefox the spec passes — those keep the legacy network
path, so the bug cannot appear there at all.

## What the pieces are

* `generate-big-module.js` writes `./big` — 300 modules of trivial exported functions. Nothing about
  their content matters, only the size of the bundle they add up to. The size in megabytes is the
  first argument: `node generate-big-module.js 20`, or `npm run generate -- 20`.
* `cypress/e2e/spec.cy.js` imports that graph and does one `cy.visit()`. The two lines it prints go
  through a `task`, because `cy.log` only reaches the report — which a stalled run never writes.
* `sweep.js` runs the whole thing once per size and records whether it finished or stalled. The loop
  has to sit outside Cypress, since a stalled run never ends by itself: each run is watched, and a
  run that goes silent after `visiting ...` is killed and recorded as stalled. Results are appended
  to `sweep-results.csv` after every size and already-measured sizes are skipped, so it can be
  interrupted and resumed.

```
node sweep.js                                    1..80 MB in steps of 1
SWEEP_SIZES=5,10,15,16,17 node sweep.js          exactly these sizes
```

## Measured here

`npx cypress run` per size, native network path (no `forceHttp1`):

| size of `./big` | result |
| --- | --- |
| 2, 5, 10 MB | passes |
| 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25 MB | passes |
| 26, 27, 28 MB | **stalls** |
| 32 MB | **stalls** |
| 45 MB | **stalls** — no timeout after 4 min, 0 % CPU |
| 45 MB, `forceHttp1: true` | passes in 17 s |

The boundary is sharp: eleven consecutive sizes pass, and from 26 MB upwards every size stalls.
There is no grey zone in between and nothing intermittent — each size was run once and every run
agreed with its neighbours. The sweep was stopped after 28 MB once the picture was clear, so sizes
above 32 MB are unmeasured.

A caveat on that number: 25/26 MB is what this machine reports, and a threshold that depends on how
fast a bundle is transferred is likely to sit somewhere else on other hardware. What should carry
over is the shape — a size below which everything passes and above which everything hangs.

## Environment

* Cypress 16.0.0 (pinned in `package.json`)
* Chrome 152, headless
* Windows 11 Enterprise 26200
* Node 24.20.0

## How we ran into it

Our real suite generates a TypeScript API per clinical study; the larger ones are 40–80 MB of
sources, bundled with `@cypress/webpack-preprocessor` and `swc-loader`. Every spec importing one of
those started hanging in its first `cy.visit()` right after the upgrade from Cypress 15.21.1, while
specs importing a 15 MB study API were unaffected. Bisecting our own code cleared everything else:
it is not `manageBrowserMemory` (turning it off does not help), not our `onBeforeLoad`, and not the
commands preceding the visit — removing only the large import makes the identical sequence pass.
This repository is that finding reduced to plain JavaScript and a public URL.
