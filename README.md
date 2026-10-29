# cypress-test-tiny – the runner tab crashes when a large spec is reloaded after a cross-origin `cy.visit()`

Reproduction for a Cypress 15.0.0 regression. A spec whose bundle carries a large inline source map
is loaded once; its first cross-origin `cy.visit()` makes the runner load it a second time. Since
15.0.0 that second load happens in the same renderer process that still holds most of the first
one, and the renderer dies at about 5 GB. Cypress does not notice: the run prints `visiting ...` and
then hangs until it is killed. 14.5.4 reloads into a fresh renderer and passes.

What makes every load that heavy is how the runner decodes the inline source map,
`$utils.decodeBase64Unicode`: `atob(…).split('').map(…).join('')`, one string per byte of the map.
For a map of 92 MB that is 13 s and 3.7 GB on its own.

## Run it

```
npm install
node generate-big-module.js 64 --two-byte   # writes ./big, 64 MB of plain JavaScript
npx cypress run
```

`./big` is generated rather than committed so this repository stays small, which is why a fresh
clone has nothing to bundle yet. Bundling takes a minute or so.

The run prints `bundle: 64 MB in 300 modules` and `visiting ...` and stops there for good. Watch
the browser's renderer processes meanwhile: one climbs to about 3.7 GB while the spec loads, falls
back to about 2.9 GB, climbs again after the visit and disappears at about 5 GB. No error appears,
and the run has to be killed.

The same run with 14.5.4 passes and prints `visit returned`. The config is plain JavaScript, so
14.5.4 can run it as it is – with the 14.5.4 binary named in `CYPRESS_RUN_BINARY`, for example:

```
CYPRESS_RUN_BINARY=<unpacked 14.5.4>/Cypress/Cypress.exe npx cypress run
```

Binaries come from `https://download.cypress.io/desktop/14.5.4?platform=win32&arch=x64`.
`defaultBrowser: 'chrome'` is pinned in `cypress.config.js`, as everything here was measured in
Chrome.

### Why `--two-byte`

It puts a single “ into the bundle. That alone makes V8 hold every copy of the bundle text, and of
the decoded source map, as a two-byte string – as it does for any project with a single character
above U+00FF anywhere in its sources (in ours, typographic quotes in comments; Latin-1 letters such
as umlauts still fit into one byte). It is also what makes the regression visible: a two-byte first load leaves about 2.9 GB behind in the renderer, a pure
ASCII one about 1.3 GB, and with pure ASCII the window in which only 15.0.0 and later crash is
narrow (see below).

## What the pieces are

* `generate-big-module.js` writes `./big` – 300 modules of trivial exported functions. Nothing about
  their content matters, only the size of the bundle they add up to and whether it contains a
  character above U+00FF. Size in megabytes as the first argument (45 by default), `--two-byte` for
  that character: `node generate-big-module.js 64 --two-byte`.
* `cypress/e2e/spec.cy.js` imports that graph and does one `cy.visit()` to another origin. The two
  lines it prints go through a `task`, because `cy.log` only reaches the report – which a run whose
  renderer died never writes.
* `sweep.js` runs the whole thing once per size and records whether it finished or went silent
  after `visiting ...`. The loop has to sit outside Cypress, since such a run never ends by itself.
  Results are appended to `sweep-results.csv` after every size and already-measured sizes are
  skipped, so it can be interrupted and resumed. `SWEEP_TWO_BYTE=1` passes `--two-byte` on – keep
  the results of both kinds of sweeps apart.

```
node sweep.js                                       # 1..80 MB in steps of 1
SWEEP_TWO_BYTE=1 SWEEP_SIZES=56,60,64 node sweep.js # exactly these sizes, two-byte
```

## Measured here

`npx cypress run`, renderer private bytes sampled from outside every few seconds.

`node generate-big-module.js 64 --two-byte`:

| Cypress | first load | reload after the cross-origin `cy.visit()` | result |
| --- | --- | --- | --- |
| 14.5.4 | renderer A peaks at 3.99 GB | a **new** renderer B starts at 0.47 GB and peaks at 4.53 GB | passes |
| 15.0.0 | renderer A peaks at 3.63 GB | the **same** renderer A starts at 2.89 GB and dies at 5.05 GB | hangs after `visiting ...` |
| 16.2.1 | renderer A peaks at 3.74 GB | the **same** renderer A starts at 2.90 GB and dies at 5.05 GB | hangs after `visiting ...` |

Without `--two-byte`:

| size of `./big` | 16.2.1 | 14.5.4 |
| --- | --- | --- |
| 72, 78 MB | passes (peak 5.3 and 4.5 GB, both loads in the same renderer) | – |
| 85 MB | **renderer dies** in the reload | **renderer dies** in the reload, although it is a fresh one (4.61 GB) |
| 100 MB | **renderer dies** at once, during the first load | – |

At 85 MB the decoding alone is too much for one renderer, whichever version. At 100 MB the source
map is 143.5 MB, past V8's maximum array length, and `split('')` kills the renderer outright.

## Environment

* Cypress 16.2.1 (pinned in `package.json`); 15.0.0 and 14.5.4 through `CYPRESS_RUN_BINARY`
* Chrome 155, headless
* Windows 11 Enterprise 26200
* Node 24.22.2

## How we ran into it

Our real suite generates a TypeScript API per clinical study, bundled with
`@cypress/webpack-preprocessor` and `swc-loader`. In Cypress 16.0 to 16.2.0 every spec importing one
of the larger ones hung in its first `cy.visit()` – that was cypress-io/cypress#34794, reproduced on
the branch `visit-hangs-with-large-spec-bundle` of this repository and fixed in 16.2.1. With the
fix, the specs importing the very largest API still hung at the same spot, and the renderer was
gone: a 189 MB bundle with 92 MB of source map, two-byte because of typographic quotes and a few
other characters above U+00FF in its sources. Our workaround leaves the generated sources out of the map and prints them without
comments, which brought that bundle down to 48 MB.
