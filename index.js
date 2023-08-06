/* global alert, window, authData */
// This is the main file for all use cases! Use the other two files to execute
let callVersions = {
    client_hello: '1.0.0',
    client_auth: '1.0.0',
    client_intents: '1.0.0',
    client_intent_send: '1.0.0',
    client_keepalive: '1.0.0',
    client_submessage: '1.0.0'
};
let retriesBeforeFatal = 10;
let retryCounts = {};
let incomingMessages = {};
let wsURLGlobal;
let wsClientGlobal;
let wsStartedAppData;
let wsAPI;
let keepalive;
let keepaliveInterval;

// A little function to create a callID so it can be changed
function getCallID() {
    return `${Date.now()}:${Math.floor(Math.random() * (999 - 100 + 1) + 100)}`;
}

// Wait for functions
async function sleep(time) {
    return new Promise((resolve) => {
        setTimeout(resolve, time);
    });
}
/**
 * Wait for a property to appear on an object.
 * @param {any} obj The object the property is on
 * @param {string} prop The property name
 * @param {number} delay ms to wait
 * @param {boolean} verbose Do log the info
 */
// eslint-disable-next-line consistent-return
async function waitFor(obj, prop, delay, verboseObjName) {
    // eslint-disable-next-line no-undef
    if (obj[prop]) return obj[prop];
    else {
        if (verboseObjName) console.log(`Waiting ${delay}ms for ${verboseObjName}.${prop}`);
        await sleep(delay);
        return waitFor(obj, prop, delay, verboseObjName);
    }
}

// Error Handling Functions
function checkError(wsAPI, appData, callType, data, callback, retry, retryData) {
    if (data.type === 'error') {
        // Error Messaging
        if (appData.errorCallback) appData.errorCallback(data);
        else if (alert) alert(data.error);
        else console.error(data.error);

        // Error Handling
        if (data.errorHandling === 'retry')
            if (!retryCounts[callType] || retryCounts[callType] < retriesBeforeFatal) {
                retryCounts[callType]++;
                retry(wsAPI, appData, retryData);
            } else wsAPI.close(data.errorCode, 'Closed due to too many retry attempts');
        else if (data.errorHandling === 'reconnect') {
            wsAPI.close(data.errorCode, 'Server asked for reconnection due to error');
            wsAPI = new wsClientGlobal(wsURLGlobal);
            // eslint-disable-next-line no-use-before-define
            wsReadyCheck(wsClientGlobal, wsURLGlobal, wsAPI, data);
        } else if (data.errorHandling === 'fatal') wsAPI.close(data.errorCode, 'Server asked for fatal close due to error');
        else if (data.errorHandling === 'ignore') {
            if (callback) callback();
            return false;
        } else if (data.errorHandling === 'attemptVersion')
            // This will be implemented as needed... for now call it fatal
            wsAPI.close(data.errorCode, 'Server asked for fatal close due to error');
        return true;
    } else {
        if (callback) callback();
        return false;
    }
}

// Keep Alive
function beginKeepAlive(){
    keepaliveInterval = setInterval(()=>{
        wsAPI.send(
            JSON.stringify({
                type: 'client_keepalive',
                version: callVersions.client_keepalive
            })
        );
    }, keepalive)
}

// This is all of the call function used externally
/**
 * Send a message to intent subscribers
 * @param wsAPI - Global wsAPI
 * @param appData - Global appData object
 * @param intent_data - Data to send to the subscribers
 */
async function client_intent_send(wsAPI, appData, intent_data) {
    return new Promise((resolve, reject) => {
        let callID = getCallID();
        wsAPI.send(
            JSON.stringify({
                type: 'client_intent_send',
                version: callVersions.client_intent_send,
                call_id: callID,
                intent: intent_data.intent,
                authData,
                intent_data
            })
        );
        waitFor(incomingMessages, callID, 500, 'incomingMessages').then((dataResp) => {
            if (checkError(wsAPI, appData, 'client_intent_send', dataResp, false, client_intent_send, intent_data)) reject();
            else resolve();
        })
    });
}

/**
 * Create a client intent
 * @param wsAPI - Global wsAPI
 * @param appData - Global appData object
 * @param {object} intent_create_data - Data to create an intent
 * @param {string} intent_create_data.intent - Intent name
 * @param {boolean} intent_create_data.permission_required - Is permission required to subscribe to the intent
 * @param {string} intent_create_data.permission_node - Permission node to subscribe if required
 * @param {boolean} intent_create_data.members_can_send - Can intent members send data at all?
 * @param {string | boolean} intent_create_data.members_send_permission - Permission for users to send to an intent or false to allow all members. (members_can_send required always)
 */
async function client_intent_send_create(wsAPI, appData, intent_create_data) {
    return new Promise((resolve, reject) => {
        let callID = getCallID();
        wsAPI.send(
            JSON.stringify({
                type: 'client_intent_send',
                version: callVersions.client_intent_send,
                call_id: callID,
                intent: intent_create_data.intent,
                authData,
                intent_create_data
            })
        );
        waitFor(incomingMessages, callID, 500, 'incomingMessages').then((dataResp) => {
            if (checkError(wsAPI, appData, 'client_intent_send', dataResp, false, client_intent_send_create, intent_create_data)) reject();
            else resolve();
        })
    });
}

// This is all of the call functions used internally
async function client_hello(wsAPI, appData) {
    // Note there is no third argument for retry because this call uses static appData
    return new Promise((resolve, reject) => {
        let callID = getCallID();
        wsAPI.send(
            JSON.stringify({
                type: 'client_hello',
                version: callVersions.client_hello,
                authentication: appData.config.authRequired,
                app_agent: appData.config.app_agent,
                call_id: callID
            })
        );
        waitFor(incomingMessages, callID, 500, 'incomingMessages').then((dataResp) => {
            if (checkError(wsAPI, appData, 'client_hello', dataResp, false, client_hello, appData)) reject();
            else {
                keepalive = dataResp.keepalive;
                if(keepaliveInterval) clearInterval(keepaliveInterval)
                beginKeepAlive()
                resolve();
            }
        });
    });
}

/**
 * If runConfigAuth is false use this to authenticate manually
 * @param wsAPI - Global wsAPI
 * @param appData - Global appData object
 * @param {object} loginData - Data to log the user in with
 * @param {string} loginData.email - User email
 * @param {string} loginData.password - User password
 */
async function client_auth(wsAPI, appData, loginData) {
    // i just LOOOOOVE authentication
    return new Promise((resolve, reject) => {
        let callID = getCallID();
        wsAPI.send(
            JSON.stringify({
                type: 'client_auth',
                version: callVersions.client_auth,
                call_id: callID,
                data: loginData
            })
        );
        waitFor(incomingMessages, callID, 500, 'incomingMessages').then((dataResp) => {
            if (checkError(wsAPI, appData, 'client_auth', dataResp, false, client_auth, loginData)) reject();
            else {
                // eslint-disable-next-line no-global-assign
                authData = {
                    authEmail: dataResp.email,
                    authToken: dataResp.token,
                    permissions: dataResp.permissions
                };
                resolve();
            }
        })
    });
}

/**
 * Ask the server to subscribe the client to intents.
 * This is used manually when authentication hasnt happened or when an error occurs and a retry is needed.
 * @param wsAPI - Global wsAPI
 * @param appData - Global appData object
 * @param intents - Intents to send to server
 */
async function client_intents(wsAPI, appData, intents) {
    if (!intents) intents = appData.config.intents;
    return new Promise((resolve, reject) => {
        let callID = getCallID();
        wsAPI.send(
            JSON.stringify({
                type: 'client_intents',
                version: callVersions.client_intents,
                call_id: callID,
                authData,
                data: {
                    intents
                }
            })
        );
        waitFor(incomingMessages, callID, 500, 'incomingMessages').then((dataResp) => {
            if (checkError(wsAPI, appData, 'client_intents', dataResp, false, client_intents, intents)) reject();
            else {
                if (dataResp.denied_intents)
                    // Dang it
                    dataResp.denied_intents.forEach((item) => {
                        if (appData.intentFail[item]) appData.intentFail[item]();
                    });
                resolve();
            }
        })
    });
}

/**
 * Send a submessage
 * This is used to send specific calls for server side application use
 * @param wsAPI - Global wsAPI
 * @param appData - Global appData object
 * @param data - Submessage data to send to server
 */
async function client_submessage(wsAPI, appData, data) {
    return new Promise((resolve, reject) => {
        let call_id = getCallID();
        wsAPI.send(
            JSON.stringify({
                type: 'client_submessage',
                version: callVersions.client_submessage,
                call_id,
                authData,
                data
            })
        );
        waitFor(incomingMessages, call_id, 500, 'incomingMessages').then((dataResp) => {
            if (checkError(wsAPI, appData, 'client_submessage', dataResp, false, client_submessage, data)) reject();
            else resolve(dataResp);
        })
    });
}

/**
 * Allow programs to get the charWS client
 */
function getClient() {
    return {
        wsAPI,
        appData: wsStartedAppData
    };
}

// This will ready and begin the connection process
async function wsReady(wsAPI, appData) {
    console.log('CharWS: Ready');
    wsAPI.onerror = (event) => {
        if(keepaliveInterval) clearInterval(keepaliveInterval)
        if(appData.wsError) appData.wsError(event)        
    }
    wsAPI.onclose = (event) => {
        if(keepaliveInterval) clearInterval(keepaliveInterval)
        if(appData.wsClose) appData.wsClose(event)        
    }
    wsAPI.onmessage = (event) => {
        let data = JSON.parse(event.data);
        if (data.type === 'server_intent_receive')
            // Intent received
            appData.intentReceived[data.intent](data);
        else incomingMessages[data.call_id] = data;
    };
    await client_hello(wsAPI, appData);
    if (appData.config.authRequired && appData.config.runConfigAuth)
        await client_auth(wsAPI, appData, {
            email: appData.config.email,
            password: appData.config.password
        });
    // *** Remember to do some logic in case we have done client_auth yet
    if (appData.config.intents) await client_intents(wsAPI, appData);
    if (appData.wsReady) appData.wsReady();
}

async function wsReadyCheck(wsClient, wsURL, wsAPI, data) {
    if (wsAPI.readyState === 0) {
        await sleep(1000);
        await wsReadyCheck(wsClient, wsURL, wsAPI, data);
    } else if (wsAPI.readyState === 2) {
        await sleep(1000);
        await wsReadyCheck(wsClient, wsURL, wsAPI, data);
    } else if (wsAPI.readyState === 3) {
        await sleep(1000);
        // eslint-disable-next-line no-use-before-define
        await run(wsClient, wsURL, data);
    } else await wsReady(wsAPI, data);
}

/**
 * Run and create a websocket client using charWS
 * @param wsClient - The websocket js to use to construct a base websocket client.
 * @param {string} wsURL - The URL of the websocket server. Ex: ws://127.0.0.1:83/websocket
 * @param {object} data - App data to use in the charWS client.
 * @param {boolean|function} data.errorCallback - An errorCallback function if wanted or false.
 * @param {function|boolean} data.wsReady - A function to call when ws ready or false
 * @param {function|boolean} data.wsError - A function to call on ws error or false
 * @param {object} data.intentFail - An object with functions by intent name if the intent fails to subscribe.
 * @param {function} data.intentFail.intentNameGoesHere - An example of where the function and intent name should go for error handling.
 * @param {object} data.intentReceived - An object with functions by intent name to run on an intent message received.
 * @param {function} data.intentReceived.intentNameGoesHere - An example of where the function and intent name should go for a received intent message.
 * @param {object} data.config - An object with configuration data.
 * @param {boolean} data.config.authRequired - Set if authentication is needed by the program to run the authentication portion.
 * @param {boolean} data.config.runConfigAuth - Should the charWS client run client_auth for you using config.email and config.password?
 * @param {string} data.config.email - Email to use with config auth.
 * @param {string} data.config.password - Password to use with config auth.
 * @param {string} data.config.app_agent - A string identifing your application for other humans formatted as `devName/projectName : devContactInfo : pageOrUsage`
 * @param {string[]|boolean} data.config.intents - A list of intents by name to attempt subscription to or false.
 */
async function run(wsClient, wsURL, data) {
    console.log('CharWS: Running');
    wsAPI = new wsClient(wsURL);
    wsURLGlobal = wsURL;
    wsClientGlobal = wsClient;
    wsStartedAppData = data;
    await wsReadyCheck(wsClient, wsURL, wsAPI, data);
}

// Exports
let _cws = { run, getClient, client_auth, client_intents, client_intent_send, client_intent_send_create, client_submessage };
try {
    if (window) window.charWS = _cws;
} catch {
    module.exports = _cws;
}
