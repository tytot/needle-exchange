'use strict'
import _rapidpro from './rapidpro'
import XPath from 'xpath'
import _ from 'lodash'

const Dom = require('xmldom').DOMParser

export default function adapter(config) {
    
    const rapidpro = _rapidpro(config.rapidpro)

    const convertRapidProContactToCSD = function (global_id, contact) {
        let name = `<commonName>${contact.name}</commonName>\n`
        let groups = ''
        let telNums = ''

        for (let groupUUID of contact.groups) {
            groups += `<codedType code="${groupUUID}" codingScheme="${config.rapidpro.url}"/>\n`
        }

        for (let urn of contact.urns) {
            if (urn.startsWith('tel:')) {
                telNums += `<contactPoint><codedType code="BP" codingScheme="urn:ihe:iti:csd:2013:contactPoint">${urn.replace('tel:', '')}</codedType></contactPoint>\n`
            }
        }

        return `
        <provider entityID="${global_id}">
          <otherID code="rapidpro_contact_id" assigningAuthorityName="${config.rapidpro.url}/${config.rapidpro.slug}">${contact.uuid}</otherID>
          ${groups}
          <demographic>
            <name>
              ${name}
            </name>
            ${telNums}
          </demographic>
        </provider>`
    }

    return {
        /**
         * convertRapidProContactToCSD - convert a RapidPro contact into CSD
         *
         * @param  {String} global_id the contact's global_id
         * @param  {Array} contact the RapidPro contact with the global_id
         * @return {String} the converted contact
         */
        convertRapidProContactToCSD: convertRapidProContactToCSD,

        /**
         * getRapidProContactsAsCSDEntities - retrieves a list of contacts from RapidPro
         * and converts them into CSD entities
         *
         * @param {Function} callback (err, contacts, orchestrations)
         */
        getRapidProContactsAsCSDEntities: function (groupUUID, callback) {
            rapidpro.getContacts(false, true, groupUUID, (contacts) => {
                let converted = []
                for (let UUID in contacts) {
                    const contact = contacts[UUID]
                    converted.push(convertRapidProContactToCSD(contact.fields.global_id, contact))
                }
                callback(null, converted)
            })
        },

        /**
         * convertCSDToContact - converts a CSD provider into a RapidPro contact
         *
         * @param  {String} entity An CSD XML representation of the provider
         * @return {Object}        A Javascript object representing the RapidPro contact
         */
        convertCSDToContact: function (entity) {
            entity = entity.replace(/\s\s+/g, '')
            entity = entity.replace(/.xmlns.*?\"(.*?)\"/g, '')
            const doc = new Dom().parseFromString(entity)
            const uuid = XPath.select('/provider/@entityID', doc)[0].value
            const name = XPath.select('/provider/demographic/name/commonName/text()', doc)[0].toString()
            const telNodes = XPath.select('/provider/demographic/contactPoint/codedType[@code="BP" and @codingScheme="urn:ihe:iti:csd:2013:contactPoint"]/text()', doc)
            let tels = []
            telNodes.forEach((telNode) => {
                tels.push('tel:' + telNode.toString())
            })

            if (tels.length === 0) {
                throw new Error(`couldn\'t find a telephone number for provider with entityID ${uuid}, this is a required field for a contact`)
            }
            const data = {
                name: name,
                urns: tels,
                fields: {
                    global_id: uuid
                }
            }
            return data
        }
    }
}