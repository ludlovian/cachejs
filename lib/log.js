'use strict'

const config = require('config')
const makeLogger = require('console-log-level')

const log = makeLogger({
  level: config.get('logLevel')
})

module.exports = log
