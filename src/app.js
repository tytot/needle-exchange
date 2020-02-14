'use strict'

import express from 'express'

import openhim from './openhim'
import { SERVER_PORT } from './config/config'
import routes from './routes/'
import logger from './logger'

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

const app = express()

app.use(express.json())
app.use('/', routes)

app.listen(SERVER_PORT, () => {
  logger.info(`Server listening on Port ${SERVER_PORT}...`)
  openhim.mediatorSetup()
})