const axios = require("axios");
require("dotenv").config();
const client = require("twilio")(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const express = require("express");
const app = express();
const port = 3030;

// Sends a new code to number (E.164 format e.g. +13109273149)
app.get("/send/:number", (req, res) => {
    client.verify.v2.services(process.env.TWILIO_SERVICE_SID)
                .verifications
                .create({to: req.params.number, channel: "sms"})
                .then(verification => res.send(verification));
})

// Checks that user-provided code is the one that was sent to number
app.get("/check/:number/:code", (req, res) => {
    console.log("checking ", req.params.number, req.params.code)
    client.verify.v2.services(process.env.TWILIO_SERVICE_SID)
                .verificationChecks
                .create({to: req.params.number, code: req.params.code})
                .then(verification => res.send(verification));

})

app.listen(port);
// holonym twilio number: +18312329705



// axios.get(`https://ipqualityscore.com/api/json/phone/${process.env.IPQUALITYSCORE_APIKEY}/${phoneNumber}?country[]=US`);