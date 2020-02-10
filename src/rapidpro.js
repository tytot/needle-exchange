'use strict'
import request from 'request'
import URI from 'urijs'
import { buildOrchestration } from './routes/utils'
import logger from './logger'
import async from 'async'
import fs from 'fs'

export default function rapidpro(config) {
    const contactsURL = function (groupUUID) {
        let url = URI(config.url).segment('api/v2/contacts.json')
        if (groupUUID) {
            url = url.addQuery('group_uuids', groupUUID)
        }
        return url.toString()
    }

    const hasGlobalID = function (contact) {
        return contact.fields && contact.fields.globalid
    }

    const getGroupUUID = function (groupName, callback) {
        let url = URI(config.url)
            .segment('api/v2/groups.json')
            .addQuery('name', groupName)
            .toString()
        let before = new Date()

        let options = {
            url: url,
            headers: {
                Authorization: `Token ${config.authtoken}`
            }
        }

        request(options, (err, res, body) => {
            isThrottled(JSON.parse(body), (wasThrottled) => {
                if (wasThrottled) {
                    //reprocess this request
                    getGroupUUID(groupName, (err, groupUUID, orchs) => {
                        return callback(err, groupUUID, orchs)
                    })
                }
                else {
                    if (err) {
                        callback(err)
                        return
                    }

                    let orchestrations = [buildOrchestration('RapidPro Obtain Group UUID', before, 'GET', options.url, null, res, body)]

                    if (res.statusCode !== 200) {
                        callback(new Error(`RapidPro responded with status ${res.statusCode}.`), null, orchestrations)
                        return
                    }

                    let results = JSON.parse(body).results
                    if (!results || results.length === 0) {
                        callback(null, null, orchestrations)
                    } else {
                        callback(null, results[0].uuid, orchestrations)
                    }
                }
            })
        })
    }

    function isThrottled(results, callback) {
        if (results == undefined || results == null || results == "") {
            logger.error("An error has occured while checking throttling, empty RapidPro results were submitted.")
            return callback(true)
        }
        if (results.hasOwnProperty("detail")) {
            let detail = results.detail.toLowerCase()
            if (detail.indexOf("throttled") != -1) {
                let detArr = detail.split(" ")
                async.eachSeries(detArr, (det, nxtDet) => {
                    if (!isNaN(det)) {
                        //add 5 more seconds on top of the wait time expected by RapidPro, then convert to milliseconds
                        let waitTime = (parseInt(det) * 1000) + 5
                        logger.warn("RapidPro has throttled requests, waiting for " + waitTime / 1000 + " seconds. Please don't interrupt.")
                        setTimeout(function () {
                            return callback(true)
                        }, waitTime)
                    }
                    else
                        return nxtDet()
                }, function () {
                    return callback(false)
                })
            }
            else
                return callback(false)
        }
        else {
            callback(false)
        }
    }

    const getContacts = function (next, requireGlobalID, groupUUID, callback) {
        if (!next) {
            let next = contactsURL(groupUUID)
        }
        logger.info(next)
        let contacts = {}
        async.doWhilst(
            function (callback) {
                let options = {
                    url: next,
                    headers: {
                        Authorization: `Token ${config.authtoken}`
                    }
                }
                request(options, (err, res, body) => {
                    if (err) {
                        logger.error(err)
                        return callback(err)
                    }
                    isThrottled(JSON.parse(body), (wasThrottled) => {
                        if (wasThrottled) {
                            //reprocess this contact
                            getContacts(next, requireGlobalID, groupUUID, (RPContacts) => {
                                next = false
                                const promises = []
                                for (let UUID in RPContacts) {
                                    promises.push(new Promise((resolve, reject) => {
                                        contacts[UUID] = RPContacts[UUID]
                                        resolve()
                                    }))
                                }
                                Promise.all(promises).then(() => {
                                    return callback(false, false)
                                })
                            })
                        }
                        else {
                            if (err) {
                                return callback(err)
                            }
                            body = JSON.parse(body)
                            if (!body.hasOwnProperty("results")) {
                                logger.error(JSON.stringify(body))
                                logger.error("An error occurred while pushing contacts to RapidPro.")
                                return callback()
                            }
                            if (body.next)
                                next = body.next
                            else
                                next = false
                            async.eachSeries(body["results"], (contact, nextCont) => {
                                if (requireGlobalID &&
                                    (
                                        !contact.fields.hasOwnProperty("globalid") ||
                                        contact.fields.globalid == null ||
                                        contact.fields.globalid == undefined ||
                                        contact.fields.globalid == ""
                                    )
                                ) {
                                    return nextCont()
                                }

                                if (contact.fields.hasOwnProperty("globalid") &&
                                    contact.fields.globalid != null &&
                                    contact.fields.globalid != undefined &&
                                    contact.fields.globalid != ""
                                ) {
                                    contacts[contact.fields.globalid] = contact
                                    return nextCont()
                                }
                                else {
                                    contacts[contact.uuid] = contact
                                    return nextCont()
                                }
                            }, function () {
                                return callback(false, next)
                            })
                        }
                    })
                })
            },
            function () {
                if (next)
                    logger.info("Fetching in " + next + ".")
                return (next != false)
            },
            function () {
                return callback(contacts)
            }
        )
    }

    const addContact = function (contact, callback) {
        let url = contactsURL()
        if (contact.hasOwnProperty("uuid"))
            url = url + "?uuid=" + contact.uuid
        let before = new Date()

        let options = {
            url: url,
            headers: {
                Authorization: `Token ${config.authtoken}`
            },
            body: contact,
            json: true
        }
        request.post(options, (err, res, newContact) => {
            if (err) {
                logger.error(err)
                return callback(err)
            }
            isThrottled(newContact, (wasThrottled) => {
                if (wasThrottled) {
                    //reprocess this contact
                    addContact(contact, (err, newContact, orchs) => {
                        return callback(err, newContact, orchs)
                    })
                }
                else {
                    if (!newContact.hasOwnProperty("uuid")) {
                        logger.error("An error occured while adding contact " + JSON.stringify(contact) + JSON.stringify(newContact) + ".")
                        fs.appendFile('unprocessed.csv', JSON.stringify(contact) + "," + JSON.stringify(newContact) + "\n", (err) => {
                            if (err) throw err;
                            return ""
                        })
                    }

                    let orchestrations = []
                    if (config.logDetailedOrch) {
                        orchestrations.push(buildOrchestration('Add/Update RapidPro Contacts', before, 'POST', options.url, JSON.stringify(contact), res, JSON.stringify(newContact)))
                    }
                    if (newContact) {
                        if (newContact.uuid) {
                            callback(null, newContact, orchestrations)
                        } else {
                            callback(null, newContact, orchestrations)
                        }
                    } else {
                        callback(new Error('No body returned, the contact most likely was not saved in RapidPro.'), null, orchestrations)
                    }
                }
            })
        })
    }

    return {
        /**
         * getGroupUUID - query RapidPro for the UUID for the configured group name
         *
         * @param {String} groupName - the name of the group whose uuid we want to fetch
         * @param {Function} callback (err, groupUUID, orchestrations)
         */
        getGroupUUID: getGroupUUID,

        /**
        Gets all currently available contacts in rapidpro
        **/
        getContacts: getContacts,
        /**
         * addContact - Adds or updates a contact to RapidPro
         *
         * @param  {Object} contact  The contact object to add
         * @param  {Function} callback (err, contact, orchestrations)
         */
        addContact: addContact
    }
}