'use strict'

import express from 'express'

import { buildReturnObject } from './utils'
import endpoint from './endpoint'
import logger from '../logger'

const routes = express.Router()

routes.get('/update', endpoint)
// Add more routes here if needed

// Any request regardless of request type or url path to the mediator port will be caught here
// and trigger the canned response. It may be useful in diagnosing incorrectly configured
// channels from the OpenHIM Console.
routes.all('*', (req, res) => {
  logger.error(
    `Failed! Endpoint "${req.url}" & HTTP method "${req.method}" combination not found.`
  )

  const returnObject = buildReturnObject('Failed', 404, {
    message: 'Combination not found',
    url: req.url,
    method: req.method
  }, [])
  res.status(404).send(returnObject)
})
module.exports = routes
