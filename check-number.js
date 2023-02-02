const assert = require("assert");
const axios = require("axios");
const { issue, getPubkey, getAddress } = require("holonym-wasm-issuer");
const { ethers } = require("ethers");
const { randomBytes } = require("crypto");
const { poseidon } = require("circomlibjs-old");
require("dotenv").config();
const client = require("twilio")(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const express = require("express");
const cors = require("cors");
const { addNumber, numberExists } = (require("./dynamodb.js"));
const { getDateAsInt } = require("./utils.js");


const app = express();
app.use(cors({origin: ["https://holonym.id", "https://www.holonym.id","https://app.holonym.id","http://localhost:3000","http://localhost:3001","http://localhost:3002"]}));
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
                if(verification.status !== "approved"){next("There was a problem verifying the with the code provided")}
                getCredentialsIfSafe("v2", req.params.number, req.params.country, next, (credentials)=>{res.send(credentials); return}, )
            });
})

app.get("/getCredentials/:number/:code/:country/", (req, res, next) => {
    req.setTimeout(10000); // Will timeout if no response from Twilio after 10s
    console.log("getCredentials was called ")
    client.verify.v2.services(process.env.TWILIO_SERVICE_SID)
            .verificationChecks
            .create({to: req.params.number, code: req.params.code})
            .then(verification => {
                if(verification.status !== "approved"){next("There was a problem verifying the with the code provided")}
                getCredentialsIfSafe("v1", req.params.number, req.params.country, next, (credentials)=>{res.send(credentials); return}, )
            });
})

// Express error handling
app.use(function (err, req, res, next) {
    res.status(err.status || 500).send(err);
    return;
  });

/* Functions */

// This version will be deprecated in favor of credsFromNumberV2
async function credsFromNumberDeprecating(phoneNumberWithPlus) {
    console.log("credsFromNumber was called ")
    const phoneNumber = phoneNumberWithPlus.replace("+", "");
    const issuer = (
        process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING ? 
            process.env.TESTING_PHONENO_ISSUER_ADDRESS 
            : 
            process.env.PHONENO_ISSUER_ADDRESS
    );
    const secret = "0x" + randomBytes(16).toString("hex");
    const completedAt = (new Date()).toISOString().split("T")[0] //gets date in yyyy-mm-dd format
    const completedAtInt = getDateAsInt(completedAt); 
    assert.equal(issuer.length, 42, "invalid issuer");
    assert.equal(secret.length, 34, "invalid secret");
    // all credentials in the order they appear in the leaf preimage, and in string format:
    const serializedCreds = [
        issuer, secret, phoneNumber, completedAtInt, 0, 0
    ].map((x) => ethers.BigNumber.from(x).toString())

    const leaf = poseidon(serializedCreds);

    const signature = await signLeaf(leaf);

    return { 
        phoneNumber: phoneNumber, 
        issuer : issuer, 
        secret : secret, 
        completedAt : completedAt,
        signature : signature,
        serializedCreds : serializedCreds
     };
}

async function credsFromNumberV2(phoneNumberWithPlus) {
    console.log("credsFromNumber was called ")
    const phoneNumber = phoneNumberWithPlus.replace("+", "");
    return issue(PRIVKEY, phoneNumber, "0");
}

async function signLeaf(leaf) {
    console.log("signLeaf was called ")
    const signable = ethers.utils.arrayify(ethers.BigNumber.from(leaf));
    // Generate the wallet from the real private key or the testing private key, depending on whether Sybil resistance is enabled
    const wallet = new ethers.Wallet(
        process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING ? process.env.TESTING_PHONENO_ISSUER_PRIVATE_KEY : process.env.PHONENO_ISSUER_PRIVATE_KEY
    );
    const signature = await wallet.signMessage(signable);
    return signature;
}

function getCredentialsIfSafe(version, phoneNumber, country, next, callback) {
    let credsFromNumber = version == "v2" ? credsFromNumberV2 : credsFromNumberDeprecating
    console.log("getCredentialsIfSafe was called")
    assert(phoneNumber && country);
    try {
        getIsSafe(phoneNumber, country, next, (isSafe) => {
            if (!isSafe) {
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

function getIsSafe(phoneNumber, country, next, callback) {
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


// function _setNumberIsRegistered(number, callback) {
//     connection.query(`INSERT INTO PhoneNumbers (Number) VALUES ('${number}')`, (err, result) => {callback(err,result)});
// }

// function _getNumberIsRegistered(number, callback) {
//     connection.query(`SELECT Number FROM PhoneNumbers WHERE Number='${number}'`, (err, result) => {callback(err, result)});
// }


/* - */
app.listen(port);
// holonym twilio number: +18312329705
