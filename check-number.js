const assert = require("assert");
const axios = require("axios");
const { randomBytes } = require("crypto");
const { ethers } = require("ethers");

require("dotenv").config();

const client = require("twilio")(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const express = require("express");
const app = express();
const port = 3030;

const MAX_FRAUD_SCORE = 2; // ipqualityscore.com defines fraud score. This constant will be used to only allow phone numbers with a <= fraud score.

const getIsSafe = (phoneNumber, country, callback) => {
    assert(phoneNumber && country);
    axios.get(`https://ipqualityscore.com/api/json/phone/${process.env.IPQUALITYSCORE_APIKEY}/${phoneNumber}?country[]=${country}`)
    .then((response) => {
        if(!("fraud_score" in response?.data)) {throw `Invalid response: ${JSON.stringify(response)} `}
        callback(response.data.fraud_score <= MAX_FRAUD_SCORE)
    })
    
}

const getCredentials = (phoneNumber, country, callback) => {
    assert(phoneNumber && country);
    getIsSafe(phoneNumber, country, (isSafe) => {
        if (!isSafe) throw "phone number could not be determined to belong to a unique human";
        callback(credsFromNumber(phoneNumber));
    });
}

// Sends a new code to number (E.164 format e.g. +13109273149)
app.get("/send/:number", (req, res) => {
    req.setTimeout(5000); // Will timeout if no response from Twilio after 5s

    client.verify.v2.services(process.env.TWILIO_SERVICE_SID)
                .verifications
                .create({to: req.params.number, channel: "sms"})
                .then(verification => res.send(verification));
})

// Checks that user-provided code is the one that was sent to number
app.get("/getCredentials/:number/:code/:country", (req, res) => {
    req.setTimeout(5000); // Will timeout if no response from Twilio after 5s

    client.verify.v2.services(process.env.TWILIO_SERVICE_SID)
                .verificationChecks
                .create({to: req.params.number, code: req.params.code})
                .then(verification => {
                    console.log(verification);
                    if(verification.status !== "approved"){throw "There was a problem verifying the with the code provided"}
                    getCredentials(req.params.number, req.params.country, (credentials)=>res.send(credentials))
                    // 
                });

})


/* Functions */
async function credsFromNumber(phoneNumber) {
    const issuer = process.env.PHONENO_ISSUER_ADDRESS;
    const secret = "0x" + randomBytes(16).toString("hex");
    const completedAt = Math.ceil(Date.now() / 1000);
    assert.equal(issuer.length, 20, "invalid issuer");
    assert.equal(secret.length, 16, "invalid secret");
    
    const leaf = poseidon([
           issuer, secret, phoneNumber, completedAt, 0, 0
         ].map((x) => ethers.BigNumber.from(x).toString())
    );
    const signature = await signLeaf(leaf);
    return { 
        phoneNumber: phoneNumber, 
        issuer : issuer, 
        secret : secret, 
        completedAt : completedAt,
        phoneNumber : phone,
        signature : signature
     };
}
async function signLeaf(leaf) {
    const signable = ethers.utils.arrayify(ethers.BigNumber.from(leafAsStr));
    const wallet = new ethers.Wallet(process.env.PHONENO_ISSUER_PRIVATE_KEY);
    const signature = await wallet.signMessage(signable);
    return signature;
}
/* - */
app.listen(port);
// holonym twilio number: +18312329705



// 