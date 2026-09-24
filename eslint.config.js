'use strict'

const neostandard = require('neostandard')
const globals = require('globals')

// libraries the configuration UI loads with <script> tags (see html/index.html)
const uiLibraries = {
  $: 'readonly',
  bootstrap: 'readonly',
  Chart: 'readonly',
  DOMPurify: 'readonly',
  qrcode: 'readonly',
  showdown: 'readonly',
  SockJS: 'readonly'
}

module.exports = [
  ...neostandard({
    env: ['mocha'],
    ignores: [
      'coverage/**',
      'lib/vendor/**',
      'lib/configurationsrv/html/vendor/**'
    ]
  }),
  {
    files: ['lib/configurationsrv/html/js/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, ...uiLibraries }
    }
  },
  {
    files: ['lib/configurationsrv/html/js/theme.js'],
    languageOptions: { sourceType: 'script' }
  }
]
