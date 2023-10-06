const assert = require("assert");
const axios = require("axios");
const { issue, getAddress } = require("holonym-wasm-issuer");
const express = require("express");
const cors = require("cors");
const {
    addNumber,
    numberExists,
    putPhoneSession,
    updatePhoneSession,
    getPhoneSessionById,
} = (require("./dynamodb.js"));
const { begin, verify } = require("./otp.js");
const { sessionsRouter } = require("./sessions.js");
const {
    sessionStatusEnum,
    maxAttemptsPerSession,
    ERROR_MESSAGES,
} = require('./constants.js');
const PhoneNumber = require('libphonenumber-js');

require("dotenv").config();
const client = require("twilio")(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const app = express();
app.use(cors({origin: ["https://holonym.id", "https://www.holonym.id","https://app.holonym.id","http://localhost:3000","http://localhost:3001","http://localhost:3002"]}));
app.use(express.json({ limit: "5mb" }));
const port = 3030;
const MAX_FRAUD_SCORE = 75; // ipqualityscore.com defines fraud score. This constant will be used to only allow phone numbers with a <= fraud score.

const PRIVKEY = process.env[`${
    (
        (process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING) && 
        (process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING === "true")
    ) ? "TESTING" : "PRODUCTION"
}_PRIVKEY`];

const ADDRESS = getAddress(PRIVKEY);

// Sends a new code to number (E.164 format e.g. +13109273149)
app.post("/send/v4", async (req, res) => {
    try {
        const number = req.body.number
        const sessionId = req.body.sessionId

        if (!number) {
            return res.status(400).send("Missing number")
        }
        if (!sessionId) {
            return res.status(400).send("Missing sessionId")
        }

        const session = await getPhoneSessionById(sessionId)

        if (!session) {
            return res.status(400).send("Invalid sessionId")
        }

        if (session.Item.sessionStatus.S !== sessionStatusEnum.IN_PROGRESS) {
            return res.status(400).send("Session is not in progress")
        }

        if (session.Item.numAttempts.N >= maxAttemptsPerSession) {
            return res.status(400).send("Session has reached max attempts")
        }

        console.log("sending to ", number)
        const countryCode = getCountryFromPhoneNumber(number);
        await begin(number, countryCode)

        const attempts = Number(session.Item.numAttempts.N) + 1
        await updatePhoneSession(sessionId, null, null, null, null, attempts, null, null)

        res.sendStatus(200)
    } catch (err) {
        if (err.response) {
            console.error("Error sending code (1)", err.response.data);
            console.error("Error sending code (2)", err.response.status);
            console.error("Error sending code (3)", err.response.headers);
        } else if (err.request) {
            console.error("Error sending code", err.request);
        } else {
            console.error("Error sending code", err);
        }

        res.status(500).send("An unknown error occurred while sending OTP")
    }
})

function getIsRegistered(phoneNumber) {
    return new Promise((resolve, reject) => {
        numberExists(phoneNumber, (err, result) => {
            console.log("is registered", result);
            if (err) {
                reject(err);
                return
            }

            if (result && !process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING) {
                resolve(true)
                return
            }
            resolve(false)
        })
    })
}

// Checks that user-provided code is the one that was sent to number, and if so, and if number is safe and not used before, returns credentials
app.get("/getCredentials/v4/:number/:code/:country/:sessionId", async (req, res) => {
    req.setTimeout(10000); 
    console.log("getCredentials v4 was called for number", req.params.number)    

    try {
        const session = await getPhoneSessionById(req.params.sessionId)

        if (!session) {
            return res.status(400).send("Invalid sessionId")
        }

        if (session.Item.sessionStatus.S !== sessionStatusEnum.IN_PROGRESS) {
            return res.status(400).send("Session is not in progress")
        }

        const result = await verify(req.params.number, req.params.code)

        if (!result) {
            await updatePhoneSession(
                req.params.sessionId,
                null,
                sessionStatusEnum.VERIFICATION_FAILED,
                null,
                null,
                null,
                null,
                null
            )

            return res.status(400).send("Could not verify number with given code")
        }

        const response = await axios.get(`https://ipqualityscore.com/api/json/phone/${process.env.IPQUALITYSCORE_APIKEY}/${req.params.number}?country[]=${req.params.country}`)
        if (!("fraud_score" in response?.data)) {
            console.error(`Invalid response: ${JSON.stringify(response)}`)
            return res.status(500).send(`Received invalid response from ipqualityscore`)
        }

        const isRegistered = await getIsRegistered(req.params.number)

        if (isRegistered) {
            console.log(`Number has been registered already. Number: ${req.params.number}. sessionId: ${req.params.sessionId}`)
            return res.status(400).send(`Number has been registered already!`)
        }

        const isSafe = response.data.fraud_score <= MAX_FRAUD_SCORE

        if (!isSafe) {
            console.log(`Phone number ${req.params.number} could not be determined to belong to a unique human`)
            return res.status(400).send(`Phone number could not be determined to belong to a unique human. sessionId: ${req.params.sessionId}`)
        }

        // Allow disabling of Sybil resistance for testing this script can be tested more than once ;)
        if (!process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING) {
            addNumber(req.params.number);
        }
        const creds = await new Promise((resolve, reject) => {
            credsFromNumber(req.params.number).then(resolve).catch(reject)
        })

        await updatePhoneSession(
            req.params.sessionId,
            null,
            sessionStatusEnum.ISSUED,
            null,
            null,
            null,
            null,
            null
        )

        return res.send(creds);
    } catch (err) {
        console.log('getCredentials v4: error', err)

        await updatePhoneSession(
            req.params.sessionId,
            null,
            sessionStatusEnum.VERIFICATION_FAILED,
            null,
            null,
            null,
            null,
            null
        )

        if (err.message === ERROR_MESSAGES.TOO_MANY_ATTEMPTS) {
            return res.status(400).send(ERROR_MESSAGES.TOO_MANY_ATTEMPTS)
        }
        if ((err.message ?? '').includes(ERROR_MESSAGES.TOO_MANY_ATTEMPTS_COUNTRY)) {
            return res.status(400).send(err.message)
        }
        if (err.message === ERROR_MESSAGES.OTP_NOT_FOUND) {
            return res.status(400).send(ERROR_MESSAGES.OTP_NOT_FOUND)
        }
        if (err.message === ERROR_MESSAGES.OTP_DOES_NOT_MATCH) {
            return res.status(400).send(ERROR_MESSAGES.OTP_DOES_NOT_MATCH)
        }

        res.status(500).send(`An unknown error occurred. Could not verify number with given code. sessionId: ${req.params.sessionId}`)
    }
})

// Sends a new code to number (E.164 format e.g. +13109273149)
app.get("/send/v3/:number", async (req, res) => {
    console.log("sending to ", req.params.number)
    const countryCode = getCountryFromPhoneNumber(req.params.number);
    await begin(req.params.number, countryCode)
    res.sendStatus(200)
})

function getCountryFromPhoneNumber(phoneNumber) {
    try {
        const parsedPhoneNumber = PhoneNumber(phoneNumber);
        const countryCode = parsedPhoneNumber.country;

        return countryCode;
    } catch(err) {
        console.error('Error parsing phone number:', err);
        next(err.message)
    }
}

// Sends a new code to number (E.164 format e.g. +13109273149)
app.get("/send/:number", (req, res) => {
    // req.setTimeout(5000); // Will timeout if no response from Twilio after 5s
    console.log("sending to ", req.params.number)
    client.verify.v2.services(process.env.TWILIO_SERVICE_SID)
                .verifications
                .create({to: req.params.number, channel: "sms"})
                .then(() => {res.status(200);return;});
                
})

// Checks that user-provided code is the one that was sent to number, and if so, and if number is safe and not used before, returns credentials
app.get("/getCredentials/v2/:number/:code/:country/", (req, res, next) => {
    req.setTimeout(10000); // Will timeout if no response from Twilio after 10s
    console.log("getCredentials v2 was called ")
    client.verify.v2.services(process.env.TWILIO_SERVICE_SID)
            .verificationChecks
            .create({to: req.params.number, code: req.params.code})
            .then(verification => {
                if(verification.status !== "approved"){next("There was a problem verifying the number with the code provided")}
                registerAndGetCredentialsIfSafe("v2", req.params.number, req.params.country, next, (credentials)=>{res.send(credentials); return}, )
            }).catch(err => {
                console.log('getCredentials v2: error', err)
                next("There was a problem verifying the number with the code provided")
            });
})

// Checks that user-provided code is the one that was sent to number, and if so, and if number is safe and not used before, returns credentials
app.get("/getCredentials/v3/:number/:code/:country/", async (req, res, next) => {
    req.setTimeout(10000); 
    console.log("getCredentials v3 was called for number",req.params.number)
    let result = false;
    
    try { 
        result = await verify(req.params.number, req.params.code)
        if(result) {
            registerAndGetCredentialsIfSafe("doesnt_matter", req.params.number, req.params.country, next, (credentials)=>{res.send(credentials); return})
        }
        
    } catch (err) {
        console.log('getCredentials v3: error', err)
        next(err.message)
    }
})

// Express error handling
app.use(function (err, req, res, next) {
    console.log("error: ", err);
    res.status(err.status || 500).send(err);
    return;
  });

/* Functions */

async function credsFromNumber(phoneNumberWithPlus) {
    console.log("credsFromNumber was called with number ", phoneNumberWithPlus)
    const phoneNumber = phoneNumberWithPlus.replace("+", "");
    return issue(PRIVKEY, phoneNumber, "0");
}

function registerAndGetCredentialsIfSafe(version, phoneNumber, country, next, callback) {
    // let credsFromNumber = version == "v2" ? credsFromNumberV2 : credsFromNumberDeprecating
    console.log("registerAndGetCredentialsIfSafe was called")
    assert(phoneNumber && country);
    try {
        registerIfSafe(phoneNumber, country, next, (isSafe) => {
            if (!isSafe) {
                console.log(`phone number ${phoneNumber} could not be determined to belong to a unique human`)
                next("phone number could not be determined to belong to a unique human")
            } else {
                credsFromNumber(phoneNumber).then(creds => callback(creds));
            }
        });
    } catch (error) {
        console.error("error", error)
        next(error);
    }
    
}

function registerIfSafe(phoneNumber, country, next, callback) {
    try {
        assert(phoneNumber && country);
        axios.get(`https://ipqualityscore.com/api/json/phone/${process.env.IPQUALITYSCORE_APIKEY}/${phoneNumber}?country[]=${country}`)
        .then((response) => {
            if(!("fraud_score" in response?.data)) {next(`Invalid response: ${JSON.stringify(response)} `)}
            numberExists(phoneNumber, (err, result) => {
                console.log("is registered", result);
                if(result && !process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING) {next("Number has been registered already!"); return}
                // Allow disabling of Sybil resistance for testing this script can be tested more than once ;)
                if(!process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING){
                    addNumber(phoneNumber);
                }
                callback(response.data.fraud_score <= MAX_FRAUD_SCORE);
            })  
        })
    } catch(err) { next(err) }
    
}

app.use("/sessions", sessionsRouter);

/* - */
app.listen(port);
// holonym twilio number: +18312329705
