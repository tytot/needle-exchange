'use strict'

import logger from '../logger'
import {buildReturnObject} from './utils'
import XPath from 'xpath'

module.exports = (_req, res) => {

  logger.info('Update Triggered')

  const OIM = openinfoman(config.openinfoman)

  function reportFailure (err, _req) {
    res.writeHead(500, {'Content-Type': 'application/json+openhim'})
    logger.error(err.stack)
    logger.error('Something went wrong; relaying error to OpenHIM-core.')
    const response = buildReturnObject(
      'Failed',
      500,
      err.stack
    )
    res.end(response)
  }

  function matchContacts(OIMContact, RPContact, callback) {
    const promises = []
    let match = ""
    for (let UUID in RPContact) {
      let contact = RPContact[UUID]
      promises.push(new Promise((resolve, reject) => {
        let ID = RPContact.fields.globalid
        if (ID == null || ID == undefined || ID == "") {
          let intersection = _.intersection(OIMContact.urns, RPContact.urns)
          if (intersection.length > 0) {
            match = contact
          }
          resolve()
        }
        else {
          resolve()
        }
      }))
    }
    Promise.all(promises).then(() => {
      callback(match)
    })
  }

  function mergeContacts(OIMContact, RPContact, UUID, callback) {
    let record = []
    let urns = OIMContact.urns
    record = RPContact
    if (!record.hasOwnProperty("urns")) {
      record.urns = []
    }
    async.eachSeries(urns, (urn, nextUrn) => {
      if (record.urns.indexOf(urn) != -1) {
        return nextUrn()
      }
      record.urns.push(urn)
      return nextUrn()
    }, () => {
      record.fields.globalid = OIMContact.fields.globalid
      const RPName = RPContact.name
      if (OIMContact.hasOwnProperty("name") && (RPName == null || RPName == undefined || RPName == "")) {
        record.name = OIMContact.name
      }
      let groups
      if (record.hasOwnProperty("groups")) {
        groups = record.groups
        delete record.groups
      }

      let UUIDs = []
      async.eachSeries(groups, (group, nextGroup) => {
        UUIDs.push(group.uuid)
        nextGroup()
      })
      if (UUIDs.length > 0) {
        record.group_uuids = []
        record.group_uuids = UUIDs
      }
      if (UUID && !record.group_uuids.includes(UUID)) {
        if (!record.hasOwnProperty("groups")) {
          record.groups = []
        }
        record.groups.push(UUID)
      }
      if (record.hasOwnProperty("groups")) {
        unique(record.groups)
      }
      return callback(record)
    })
  }
  function createContacts(OIMContacts, RPContacts, UUID, callback) {
    let records = []
    async.eachSeries(OIMContacts, (OIMContact, nextOIMContact) => {
      if (!OIMContact.hasOwnProperty("fields") || !OIMContact.fields.hasOwnProperty("globalid") || !OIMContact.hasOwnProperty("urns") || Object.keys(OIMContact.urns).length == 0) {
        return nextOIMContact()
      }
      let globalID = OIMContact.fields.globalID
      if (!globalID) {
        return nextOIMContact()
      }
      let urns = OIMContact.urns

      if (RPContacts.hasOwnProperty(globalID)) {
        mergeContacts(RPContacts[globalID], OIMContact, UUID, (record) => {
          if (record.language == "") {
            record.language = null
          }
          records.push(record)
          return nextOIMContact()
        })
      } else {
        matchContacts(OIMContact, RPContacts, (match) => {
          if (match.UUID != null && match.UUID != undefined && match.UUID != "") {
            mergeContacts(match, OIMContact, (recrod) => {
              if (record.language == "") {
                record.language = null
              }
              records.push(record)
              return nextOIMCont()
            })
          } else {
            let record = {"urns": urns, "fields": {"globalid": globalID}}
            if (OIMContact.hasOwnProperty("name")) {
              record.name = OIMContact.name
            }
            if (UUID) {
              if (record.hasOwnProperty("groups")) {
                record.groups.push(UUID)
              } else {
                record.groups = []
                record.groups.push(UUID)
              }
            }
            if (record.language == "") {
              record.language = null
            }
            records.push(record)
            return nextOIMContact()
          }
        })
      }
    }, () => {
      callback(records)
    })
  }

  logger.info('Pulling providers from OpenInfoMan...')
  OIM.fetchAllEntities(config.sync.lastFetch, config.sync.reset, (err, CSDDoc, orchs) => {
    if (orchs) {
      orchestrations = orchestrations.concat(orchs)
    }
    if (err) {
      return reportFailure(err, req)
    }
    if (!CSDDoc) {
      return reportFailure(new Error('No CSD document returned.'), req)
    }
    logger.info('Done fetching providers.')
  })

  const returnObject = buildReturnObject(
    'Successful',
    200,
    'Endpoint Response!'
  )
  return res.send(returnObject)
}
