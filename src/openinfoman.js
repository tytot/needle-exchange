'use strict'

import request from 'request'
import URI from 'urijs'
import utils from './utils'

module.exports = function(cfg) {
    const config = cfg
    
    return {
        /**
         * fetches all entities in a particular CSD document and calls back with the full CSD document.
         * @param {string in the form 'yyyy-mm-ddThh:mm:ss'} lastFetch : the last time the document was fetched
         * @param {boolean} reset : whether or not to reset lastFetch
         * @param {function} callback : takes the form of callback(err, result, orchestrations)
         */
        fetchAllEntities: function(lastFetch, reset, callback) {
            let url = new URI(config.url).segment('CSD/csr').segment(config.queryDocument)
            .segment('careServicesRequest').segment('/urn:ihe:iti:csd:2014:stored-function:provider-search')

            if (reset) {
                let record = '<csd:record updated="1970-01-01T00:00:00"/>'
            } else {
                let record = '<csd:record updated="' + lastFetch + '"/>'
            }
            let username = config.username
            let password = config.password
            let auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
            let options = {
                url: URI.toString(),
                headers: {
                    Authorization: auth,
                    'Content-Type': 'text/xml'
                },
                body: `<csd:requestParams xmlns:csd="urn:ihe:iti:csd:2013">${record}</csd:requestParams>`
            }
            let before = new Date()
            request.post(options, (err, res, body) => {
                if (err) {
                    return callback(err)
                }
                callback(null, body, [utils.buildOrchestration('Fetch OpenInfoMan Entities', before, 'POST', options.url, options.body, res, body)])
            })
        },

        /**
         * loads a complete provider directory into OpenInfoMan. 
         * Note: will clear any existing data in the directory to load the new contents
         * @param {array} providers : a string array containing XML provider entities
         * @param {function} callback : takes the form of callback(err, orchestrations) 
         */
        loadProviders: function(providers, callback) {
            let orchestrations = []
            let username = config.username
            let password = config.password
            let auth = "Basic " + new Buffer(username + ":" + password).toString("base64")

            let emptyDirectoryURI = new URI(config.url).segment('CSD/emptyDirectory/').segment(config.rapidProDocument)
            let options = {
                url: emptyDirectoryURI.toString(),
                headers: {
                    Authorization: auth
                }
            }
            let before = new Date()
            request.get(options, (err, res, body) => {
                if (err) {
                    return callback(err)
                }
                orchestrations.push(utils.buildOrchestration('Clear OpenInfoMan RapidPro Directory', before, 'GET', emptyDirectoryURI.toString(), null, res, body))

                let updateURI = new URI(config.url).segment('/CSD/csr/').segment(config.rapidProDocument)
                .segment('/careServicesRequest/update/urn:openhie.org:openinfoman:provider_create')

                let options = {
                    url: updateURI.toString(),
                    headers: {
                        Authorization: auth,
                        'Content-Type': 'text/xml'
                    },
                    body: `<requestParams xmlns="urn:ihe:iti:csd:2013" xmlns:csd="urn:ihe:iti:csd:2013">${providers.join('\n')}</requestParams>`
                }
                before = new Date()
                request.post(options, (err, res, body) => {
                    if (err) {
                        return callback(err)
                    }
                    orchestrations.push(utils.buildOrchestration('Load OpenInfoMan RapidPro Directory', before, 'POST', options.url, options.body, res, body))
                    callback(null, orchestrations)
                })
            })
        }
    }
}