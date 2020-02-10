module.exports = {
  "urn": "urn:mediator:needle-exchange",
  "version": "1.0.0",
  "name": "Needle Exchange Mediator",
  "description": "An interactive needle exchange system featuring OpenHIM, OpenInfoMan, and RapidPro",
  "defaultChannelConfig": [{
    "name": "OpenInfoMan Update from RapidPro",
      "urlPattern": "^/openinfoman-rapidpro$",
      "pollingSchedule": "15 07,13 * * *",
      "status": "enabled",
      "routes": [{
        "name": "Sync OpenInfoMan and RapidPro Contacts",
        "secured": false,
        "host": "localhost",
        "port": 3002,
        "path": "/update",
        "primary": true,
        "status": "enabled",
        "type": "http"
      }],
      "authType": "private",
      "allow": [
        "needle"
      ],
      "type": "polling"
  }],
  "endpoints": [
    {
      "name": "Needle Exchange Endpoint",
      "host": "localhost",
      "path": "/update",
      "port": "3002",
      "primary": true,
      "type": "http"
    }
  ],
  "configDefs": [{
    "param": "rapidpro",
    "displayName": "RapidPro Server",
    "description": "The RapidPro server to sync contacts with",
    "type": "struct",
    "template": [{
        "param": "url",
        "displayName": "URL",
        "description": "The base URL (e.g. http://localhost:8000)",
        "type": "string"
      },
      {
        "param": "slug",
        "displayName": "Slug",
        "description": "Find your slug on Your Account page under your organization",
        "type": "string"
      },
      {
        "param": "authtoken",
        "displayName": "Authentication Token",
        "description": "Find your authentication token for the RapidPro API on Your Account page",
        "type": "string"
      },
      {
        "param": "groupname",
        "displayName": "Group Name",
        "description": "Restricts adding and searching for RapidPro contacts to only this group",
        "type": "string"
      },
      {
        "param": "logDetailedOrch",
        "displayName": "Log detailed orchestrations",
        "description": "Log each RapidPro orchestration that adds/updates a contact; this can get very large so it is disabled by default",
        "type": "bool"
      }
    ]
  }, {
    "param": "openinfoman",
    "displayName": "OpenInfoMan Server",
    "description": "The OpenInfoMan server to sync providers with",
    "type": "struct",
    "template": [{
        "param": "url",
        "displayName": "URL",
        "description": "The base URL (e.g. http://localhost:8984)",
        "type": "string"
      },
      {
        "type": "string",
        "description": "Username",
        "displayName": "Username",
        "param": "username"
      },
      {
        "type": "password",
        "description": "Password",
        "displayName": "Password",
        "param": "password"
      },
      {
        "param": "queryDocument",
        "displayName": "Provider query document",
        "description": "The CSD document to query providers from in order to send to RapidPro",
        "type": "string"
      },
      {
        "param": "rapidProDocument",
        "displayName": "RapidPro contacts document",
        "description": "The CSD document to store contacts retrieved from RapidPro",
        "type": "string"
      }
    ]
  }, {
    "param": "sync",
    "displayName": "Sync Configuration",
    "description": "Sync Configuration",
    "type": "struct",
    "template": [{
        "param": "last_sync",
        "displayName": "Last Sync",
        "description": "Only data that were updated after this time will be fetched from the HRIS (format YYYY-MM-DDTHH:MM:SS)",
        "type": "string"
      },
      {
        "param": "reset",
        "displayName": "Reset Last Sync",
        "description": "If set to yes then all data will be synced, ignoring last sync",
        "type": "bool"
      }
    ]
  }],
  "config": {
    "rapidpro": {
      "url": "http://localhost:8000",
      "slug": "",
      "authtoken": "",
      "groupname": "",
      "logDetailedOrch": false
    },
    "openinfoman": {
      "url": "http://localhost:8984",
      "queryDocument": "Providers",
      "rapidProDocument": "RapidProContacts"
    },
    "sync": {
      "last_sync": "1970-01-01T00:00:00",
      "reset": false
    }
  }
}
