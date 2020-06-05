'use strict'

import URI from 'urijs'

export let urn 
export const setMediatorUrn = mediatorUrn => {
  urn = mediatorUrn
}

// The OpenHIM accepts a specific response structure which allows transactions to display correctly
// The openhimTransactionStatus can be one of the following values:
// Successful, Completed, Completed with Errors, Failed, or Processing
export const buildReturnObject = (
  openhimTransactionStatus,
  httpResponseStatusCode,
  responseBody,
  orchs
) => {
  return {
    'x-mediator-urn': urn,
    status: openhimTransactionStatus,
    response: {
      status: httpResponseStatusCode,
      timestamp: new Date(),
      headers: { 'content-type': 'application/json' },
      body: responseBody
    },
    orchestrations: orchs
  }
}

export const buildOrchestration = (name, beforeTimestamp, method, url, requestContent, res, body) => {
  let uri = new URI(url)
  return {
    name: name,
    request: {
      method: method,
      body: requestContent,
      timestamp: beforeTimestamp,
      path: uri.path(),
      querystring: uri.query()
    },
    response: {
      status: res.statusCode,
      headers: res.headers,
      body:"bruh",
      timestamp: new Date()
    }
  }
}
