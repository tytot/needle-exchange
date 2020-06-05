'use strict'

import logger from '../logger'
import openinfoman from '../openinfoman'
import openhim from '../openhim'
import _rapidpro from '../rapidpro'
import _adapter from '../adapter'
import XPath from 'xpath'
import _ from 'underscore'
import async from 'async'
import { DOMParser } from 'xmldom'
import { buildReturnObject, _urn } from './utils'
import { fetchConfig } from 'openhim-mediator-utils'

module.exports = (_req, res) => {
  fetchConfig(openhim.config, (err, newConfig) => {
    let config = newConfig

    logger.info('Update Triggered...')

    let orchestrations = []
    const OIM = openinfoman(config.openinfoman)
    const adapter = _adapter(config)
    const rapidpro = _rapidpro(config.rapidpro)
    rapidpro.addCustomField("Global ID")

    function reportFailure(err, _req) {
      res.writeHead(500, { 'Content-Type': 'application/json+openhim' })
      logger.error(err.stack)
      logger.error('Something went wrong; relaying error to OpenHIM-core.')
      const response = buildReturnObject(
        'Failed',
        500,
        err.stack,
        orchestrations
      )
      res.end(response)
    }

    function matchContacts(OIMContact, RPContacts, callback) {
      const promises = []
      let match = ""
      for (let UUID in RPContacts) {
        let RPContact = RPContacts[UUID]
        promises.push(new Promise((resolve, reject) => {
          let ID = RPContact.fields.global_id
          if (ID == null || ID == undefined || ID == "") {
            let intersection = _.intersection(OIMContact.urns, RPContact.urns)
            if (intersection.length > 0) {
              match = RPContact
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

    function extractGroupUUIDs(groups, callback) {
      let UUIDs = []
      async.eachSeries(groups, (group, nextGroup) => {
        UUIDs.push(group.uuid)
        nextGroup()
      }, function() {
        return callback(UUIDs)
      })
    }

    function mergeContacts(RPContact, OIMContact, groupUUID, callback) {
      // console.log('merging')
      // console.log(OIMContact)
      // console.log('with')
      // console.log(RPContact)
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
        record.fields.global_id = OIMContact.fields.global_id
        const RPName = RPContact.name
        if (OIMContact.hasOwnProperty("name") && (RPName == null || RPName == undefined || RPName == "")) {
          record.name = OIMContact.name
        }
        let groups
        if (record.hasOwnProperty("groups")) {
          groups = record.groups
          delete record.groups
        }

        extractGroupUUIDs(groups, (UUIDs) => {
          if (UUIDs.length > 0) {
            record.group_uuids = []
            record.group_uuids = UUIDs
          }
          if (groupUUID && !record.group_uuids.includes(groupUUID)) {
            if (!record.hasOwnProperty("groups")) {
              record.groups = []
            }
            record.groups.push(groupUUID)
          }
          if (record.hasOwnProperty("groups")) {
            unique(record.groups)
          }
          return callback(record)
        })
      })
    }
    function createContacts(OIMContacts, RPContacts, groupUUID, callback) {
      let records = []
      async.eachSeries(OIMContacts, (OIMContact, nextOIMContact) => {
        if (!OIMContact.hasOwnProperty("fields") || !OIMContact.fields.hasOwnProperty("global_id") || !OIMContact.hasOwnProperty("urns") || Object.keys(OIMContact.urns).length == 0) {
          return nextOIMContact()
        }
        let globalID = OIMContact.fields.global_id
        if (!globalID) {
          return nextOIMContact()
        }

        //if a RapidPro contact has this global ID, merge the contacts
        if (RPContacts.hasOwnProperty(globalID)) {
          mergeContacts(RPContacts[globalID], OIMContact, groupUUID, (record) => {
            records.push(record)
            return nextOIMContact()
          })
        //else, match the contacts by phone number
        } else {
          matchContacts(OIMContact, RPContacts, (match) => {
            if (match.uuid != null && match.uuid != undefined && match.uuid != "") {
              mergeContacts(match, OIMContact, groupUUID, (record) => {
                records.push(record)
                return nextOIMContact()
              })
            } else {
              const urns = OIMContact.urns
              let record = { "urns": urns, "fields": { "global_id": globalID } }
              if (OIMContact.hasOwnProperty("name")) {
                record.name = OIMContact.name
              }
              if (groupUUID) {
                if (record.hasOwnProperty("groups")) {
                  record.groups.push(groupUUID)
                } else {
                  record.groups = []
                  record.groups.push(groupUUID)
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
    OIM.fetchAllEntities((err, CSDDoc, orchs) => {
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
      //console.log(doc)
      const select = XPath.useNamespaces({ 'csd': 'urn:ihe:iti:csd:2013' })
      let entities = select('/csd:CSD/csd:providerDirectory/csd:provider', doc)
      entities = entities.map((entity) => entity.toString())
      logger.info(`Converting ${entities.length} CSD entities to RapidPro contacts...`)
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
        //Get RapidPro contacts to check which ones are already there
        logger.info("Obtaining RapidPro contacts...")
        rapidpro.getContacts(false, false, false, (RPContacts) => {
          logger.info(`Successfully obtained RapidPro contacts.`)
          logger.info("Creating contacts based on OIM and RapidPro...")
          createContacts(contacts, RPContacts, groupUUID, (contacts) => {
            logger.info("Creation successful.")
            //Add contacts to RapidPro
            let errCount = 0
            logger.info(`Adding/Updating ${contacts.length} contacts to RapidPro...`)
            let totalContacts = contacts.length
            let counter = 0
            let promises = []
            contacts.forEach((contact) => {
              promises.push(new Promise((resolve, reject) => {
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
                  resolve()
                })
              }))
            })

            Promise.all(promises).then(() => {
              logger.info(`Done adding/updating ${contacts.length} contacts to RapidPro, there were ${errCount} errors.`)
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
                OIM.loadProviders(contacts, (err, orchs) => {
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
                    'Endpoint Response!',
                    orchestrations
                  )
                  res.set('Content-Type', 'application/json+openhim')
                  res.send(returnObject)
                })
              })
            })
          })
        })
      }, (err) => {
        return reportFailure(err, req)
      })
    })
  })
}