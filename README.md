# cypress-test-tiny — the first `cy.visit()` hangs forever when the spec bundle is large

Reproduction for a Cypress 16.0.0 regression: the first `cy.visit()` of a spec never returns once
the spec bundle gets large. There is no error and no timeout — `pageLoadTimeout` never fires and the
browser process sits at 0 % CPU, so the run has to be killed. `forceHttp1: true` makes the very same
spec pass.

## Run it

```
npm install
npm run generate                      # writes ./big, about 45 MB of plain JavaScript
npx cypress run --browser chrome
```

Bundling takes a couple of minutes the first time, and that part is expected: node sits at 100 % CPU
while webpack works through 45 MB. Then the run prints the `page` suite name, stops in
`cy.visit('https://example.cypress.io')`, and stays there — measured for 4 minutes against a default
`pageLoadTimeout` of 60 s, with the browser at 0.03 s CPU over a 20 s sample.

The same run on the legacy network path passes:

```
npx cypress run --browser chrome --config forceHttp1=true
```

## What the pieces are

* `generate-big-module.js` writes `./big` — 300 modules of trivial exported functions. Nothing about
  their content matters, only the size of the bundle they add up to. It is generated rather than
  committed so this repository stays small, and `./big` is git-ignored. The size in megabytes is the
  first argument (`node generate-big-module.js 20`), which is how the threshold below was found.
* `cypress/e2e/spec.cy.js` imports that graph and does one `cy.visit()`. Nothing else.

## Measured here

Same machine, same spec, `cypress run --browser chrome`:

| size of `./big` | `forceHttp1` | result |
| --- | --- | --- |
| 20 MB | off | passes in 9 s |
| 32 MB | off | **hangs forever** |
| 45 MB | off | **hangs forever** — no timeout after 4 min, 0 % CPU |
| 45 MB | on | passes in 17 s |

So the threshold sits between 20 and 32 MB here. The second run at a given size is fast because the bundle is cached, which is worth noting: with a
warm cache the 45 MB run reaches the visit in about 30 s and then hangs just the same, so the stall
is not the bundling.

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
