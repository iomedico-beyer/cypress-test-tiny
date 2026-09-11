module.exports = {
  /*
   * Pin the browser. A plain "npx cypress run" would otherwise take the bundled Electron, which
   * keeps the legacy network path and therefore never shows this bug at all.
   */
  defaultBrowser: 'chrome',
  e2e: {
    setupNodeEvents(on) {
      /*
       * Prints from the browser into the runner's stdout while the test is still running. cy.log
       * only reaches the report after the test ends, so a run that stalls would show nothing.
       */
      on('task', {
        log(message) {
          console.log(message)
          return null
        },
      })
    },
  },
}
