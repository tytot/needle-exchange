'use strict'

import logger from '../logger'
import openinfoman from '../openinfoman'
import openhim from '../openhim'
import _rapidpro from '../rapidpro'
import _adapter from '../adapter'
import XPath from 'xpath'
import _ from 'underscore'
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

    function reportFailure(err, _req) {
      res.writeHead(500, { 'Content-Type': 'application/json+openhim' })
      logger.error(err.stack)
      logger.error('Something went wrong; relaying error to OpenHIM-core.')
      const response = buildReturnObject(
        'Failed',
        500,
        err.stack,
        _req,
        orchestrations
      )
      res.end(response)
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
        if (groupUUID) {
          logger.info('Adding group to each contact...')
          contacts = contacts.map((c) => {
            c.groups = [groupUUID]
            return c
          })
          logger.info('Done.')
        }

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
                _req,
                orchestrations
              )
              return res.end(JSON.stringify(returnObject))
            })
          })
        })
      }, (err) => {
        return reportFailure(err, req)
      })
    })
  })
}