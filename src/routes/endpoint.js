'use strict'

import logger from '../logger'
import openinfoman from '../openinfoman'
import openhim from '../openhim'
import rapidpro from '../rapidpro'
import adapter from '../adapter'
import { buildReturnObject } from './utils'
import async from 'async'
import unique from 'array-unique'
import XPath from 'xpath'
import _ from 'underscore'
import { DOMParser } from 'xmldom'

let config = {}
import apiConf from '../config/config'
import mediatorConfig from '../config/mediatorConfig'

export function endpoint(_req, res) {

  logger.info('Update Triggered')

  const OIM = openinfoman(config.openinfoman)
  const OpenHIM = openhim(apiConf.api)
  const adapter = adapter(config)

  function reportFailure(err, _req) {
    res.writeHead(500, { 'Content-Type': 'application/json+openhim' })
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
            let record = { "urns": urns, "fields": { "globalid": globalID } }
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

    //extract CSD entities
    const doc = new DOMParser().parseFromString(CSDDoc)
    const select = XPath.useNamespaces({ 'csd': 'urn:ihe:iti:csd:2013' })
    let entities = select('/csd:CSD/csd:providerDirectory/csd:provider', doc)
    entities = entities.map((entity) => entity.toString())
    logger.info('Converting ${entities.length} CSD entities to RapidPro contacts...')
    let contacts = entities.map((entity) => {
      try {
        return adapter.convertCSDToContact(entity)
      } catch (err) {
        logger.warn(`${err.message}, skipping contact.`)
        return null
      }
    }).filter((c) => {
      return c !== null
    })
    logger.info('Done converting Providers to RapidPro Contacts.')

    new Promise((resolve, reject) => {
      if (config.rapidpro.groupname) {
        logger.info('Fetching group UUID for RapidPro...')
        rapidpro.getGroupUUID(config.rapidpro.groupname, (err, groupUUID, orchs) => {
          if (orchs) {
            orchestrations = orchestrations.concat(orchs)
          }
          if (err) {
            reject(err)
          }
          logger.info(`Done fetching group UUID: ${groupUUID}.`)
          resolve(groupUUID)
        })
      } else {
        resolve(null)
      }
    }).then((groupUUID) => {
      let errCount = 0
      logger.info("Fetching RapidPro contacts.")
      rapidpro.getContacts(false, false, false, (RPContacts) => {
        logger.info("Done getting RapidPro contacts.")
        logger.info("Generating contacts based on HRIS and RapidPro.")
        createContacts(contacts, RPContacts, groupUUID, (contacts) => {
          logger.info("Done generating contacts based on HRIS and RapidPro.")
          logger.info(`Adding/Updating ${contacts.length} contacts to RapidPro...`)
          /* RapidPro is limited to 2500 requests per hour, meaning 1 reqest/1.44 seconds.
            calculate the number of milliseconds to wait before processing the next contact
          */
          let totalContacts = contacts.length
          let counter = 0
          async.eachSeries(contacts, (contact, nextContact) => {
            rapidpro.addContact(contact, (err, contact, orchs) => {
              counter++
              logger.info("Processed " + counter + "/" + totalContacts + " contacts.")
              if (orchs) {
                orchestrations = orchestrations.concat(orchs)
              }
              if (err) {
                logger.error(err)
                errCount++
              }
              return nextContact()
            })
          }, function () {
            logger.info(`Done adding/updating ${contacts.length} contacts to RapidPro, there were ${errCount} errors.`)
            let now = moment().format("YYYY-MM-DDTHH:mm:ss")
            config.sync.last_sync = now
            config.sync.reset = false
            logger.info("Updating last sync.")
            OpenHIM.updateConfig(mediatorConfig.urn, config, (res) => {
              logger.info("Done updating last sync.")
            })
            logger.info('Fetching RapidPro contacts and converting them to CSD entities...')
            adapter.getRapidProContactsAsCSDEntities(groupUUID, (err, contacts, orchs) => {
              if (orchs) {
                orchestrations = orchestrations.concat(orchs)
              }
              if (err) {
                return reportFailure(err, req)
              }
              logger.info(`Done fetching and converting ${contacts.length} contacts.`)

              logger.info('Loading provider directory with contacts...')
              openinfoman.loadProviderDirectory(contacts, (err, orchs) => {
                if (orchs) {
                  orchestrations = orchestrations.concat(orchs)
                }
                if (err) {
                  return reportFailure(err, req)
                }
                logger.info('Done loading provider directory.')

                const returnObject = buildReturnObject(
                  'Successful',
                  200,
                  'Endpoint Response!'
                )
                return res.end(returnObject)
              })
            })
          })
        })
      })
    }, (err) => {
      return reportFailure(err, req)
    })
  })
}