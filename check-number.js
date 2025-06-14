const assert = require("assert");
const axios = require("axios");
const { issue: issuev0, getAddress } = require("holonym-wasm-issuer-v0");
const {
  issue: issuev2,
  getAddress: getAddressv1,
} = require("holonym-wasm-issuer-v2");
const express = require("express");
const cors = require("cors");
const {
  addNumber,
  numberExists,
  getNumber,
  putPhoneSession,
  updatePhoneSession,
  getPhoneSessionById,
  putNullifierAndCreds,
  getNullifierAndCredsByNullifier
} = require("./dynamodb.js");
const { redis } = require('./redis.js');
const { failPhoneSession, setPhoneSessionIssued } = require('./sessions-utils.js')
const { timestampIsWithinLast5Days } = require("./utils.js");
const { begin, verify } = require("./otp.js");
const { sessionsRouter } = require("./sessions.js");
const { adminRouter } = require("./admin.js");
const {
  sessionStatusEnum,
  maxAttemptsPerSession,
  ERROR_MESSAGES,
} = require("./constants.js");
const PhoneNumber = require("libphonenumber-js");

require("dotenv").config();
const client = require("twilio")(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const app = express();
app.use(
  cors({
    origin: [
      "https://id.human.tech",
      "https://holonym.id",
      "https://www.holonym.id",
      "https://app.holonym.id",
      "https://silksecure.net",
      "https://silkysignon.com",
      "https://staging-silkysignon.com",
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
    ],
  })
);
app.use(express.json({ limit: "5mb" }));
const port = 3030;
const MAX_FRAUD_SCORE = 75; // ipqualityscore.com defines fraud score. This constant will be used to only allow phone numbers with a <= fraud score.

const PRIVKEY =
  process.env[
    `${
      process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING &&
      process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING === "true"
        ? "TESTING"
        : "PRODUCTION"
    }_PRIVKEY`
  ];

const ADDRESS = getAddress(PRIVKEY);

const MAX_SENDS_PER_30_DAYS = 20;

// Sends a new code to number (E.164 format e.g. +13109273149)
app.post("/send/v4", async (req, res) => {
  try {
    const number = req.body.number;
    const sessionId = req.body.sessionId;

    if (!number) {
      return res.status(400).send("Missing number");
    }
    if (!sessionId) {
      return res.status(400).send("Missing sessionId");
    }

    const session = await getPhoneSessionById(sessionId);

    if (!session?.Item) {
      return res.status(400).send("Invalid sessionId");
    }

    if (session.Item.sessionStatus.S !== sessionStatusEnum.IN_PROGRESS) {
      return res
        .status(400)
        .send(
          `Session status is ${session.Item.sessionStatus.S}. Expected ${sessionStatusEnum.IN_PROGRESS}.`
        );
    }

    if (session.Item.numAttempts.N >= maxAttemptsPerSession) {
      await failPhoneSession(sessionId, "Session has reached max attempts")
      return res.status(400).send("Session has reached max attempts");
    }

    const isRegistered = await getIsRegisteredWithinLast11Months(number);

    if (isRegistered) {
      console.log(
        `/send/v4: Number has been registered already. Number: ${number}. sessionId: ${sessionId}`
      );

      return res.status(400).send(`Number has been registered already!`);
    }

    // Rate limiting
    const ip = req.headers['x-forwarded-for'] ?? req.socket.remoteAddress
    const key = `NUM_SENDS_BY_IP:${ip}`;
    const count = await redis.incr(key);
    const ttl = await redis.ttl(key);
    // -2 means the key does not exist. -1 means the key is not set to expire.
    if (ttl < 0) {
      await redis.expire(key, 60 * 60 * 24 * 30);
    }
    if (count > MAX_SENDS_PER_30_DAYS) {
      return res.status(429).json({ error: `${ERROR_MESSAGES.TOO_MANY_ATTEMPTS_IP} ${ip}` });
    }

    console.log("sending to ", number);
    const countryCode = getCountryFromPhoneNumber(number);
    await begin(number, countryCode);

    const attempts = Number(session.Item.numAttempts.N) + 1;
    await updatePhoneSession(
      sessionId,
      null,
      null,
      null,
      null,
      attempts,
      null,
      null,
      null
    );

    res.sendStatus(200);
  } catch (err) {
    if (err.message.includes(ERROR_MESSAGES.TOO_MANY_ATTEMPTS_COUNTRY)) {
      return res.status(400).json({ error: err.message })
    } else if (err.response) {
      console.error("Error sending code (1)", err.response.data);
      console.error("Error sending code (2)", err.response.status);
      console.error("Error sending code (3)", err.response.headers);
    } else if (err.request) {
      console.error("Error sending code", err.request);
    } else {
      console.error("Error sending code", err);
    }

    res.status(500).send("An unknown error occurred while sending OTP");
  }
});

function getIsRegistered(phoneNumber) {
  return new Promise((resolve, reject) => {
    numberExists(phoneNumber, (err, result) => {
      console.log("is registered", result);
      if (err) {
        reject(err);
        return;
      }

      if (result && !process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING) {
        resolve(true);
        return;
      }
      resolve(false);
    });
  });
}

function getIsRegisteredWithinLast11Months(phoneNumber) {
  return new Promise((resolve, reject) => {
    getNumber(phoneNumber, (err, result) => {
      console.log("result", result);
      if (err) {
        reject(err);
        return;
      }

      if (
        result?.Item?.insertedAt &&
        !process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING
      ) {
        const now = new Date();
        const insertedAt = new Date(parseInt(result.Item.insertedAt.N));

        // If the number was inserted within the last 11 months, it is considered registered
        if (now - insertedAt < 1000 * 60 * 60 * 24 * 30 * 11) {
          resolve(true);
          return;
        } else {
          resolve(false);
          return;
        }
      }
      resolve(false);
    });
  });
}

function getIsRegisteredWithinLast11MonthsAndNotLast5Days(phoneNumber) {
  return new Promise((resolve, reject) => {
    getNumber(phoneNumber, (err, result) => {
      if (err) {
        reject(err);
        return;
      }

      if (
        result?.Item?.insertedAt &&
        !process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING
      ) {
        const now = new Date();
        const insertedAt = new Date(parseInt(result.Item.insertedAt.N));

        console.log('insertedAt', insertedAt)

        const insertedWithinLast11Months = now - insertedAt < 1000 * 60 * 60 * 24 * 30 * 11
        const insertedOver5DaysAgo = now - insertedAt > 1000 * 60 * 60 * 24 * 5
        if (
          insertedWithinLast11Months && insertedOver5DaysAgo
        ) {
          resolve(true);
          return;
        } else {
          resolve(false);
          return;
        }
      }
      resolve(false);
    });
  });
}

// Checks that user-provided code is the one that was sent to number, and if so, and if number is safe and not used before, returns credentials
app.get(
  "/getCredentials/v4/:number/:code/:country/:sessionId",
  async (req, res) => {
    req.setTimeout(10000);
    console.log("getCredentials v4 was called for number", req.params.number);

    try {
      const session = await getPhoneSessionById(req.params.sessionId);

      if (!session) {
        return res.status(400).send({ error: "Invalid sessionId" });
      }

      if (session.Item.sessionStatus.S !== sessionStatusEnum.IN_PROGRESS) {
        return res.status(400).send({
          error: `Session status is ${session.Item.sessionStatus.S}. Expected ${sessionStatusEnum.IN_PROGRESS}.`,
        });
      }

      const result = await verify(req.params.number, req.params.code);

      if (!result) {
        await failPhoneSession(
          req.params.sessionId,
          "Could not verify number with given code"
        )

        return res
          .status(400)
          .send({ error: "Could not verify number with given code" });
      }

      const response = await axios.get(
        `https://ipqualityscore.com/api/json/phone/${process.env.IPQUALITYSCORE_APIKEY}/${req.params.number}?country[]=${req.params.country}`
      );
      if (!("fraud_score" in response?.data)) {
        console.error(`Invalid response: ${JSON.stringify(response)}`);
        return res
          .status(500)
          .send({ error: `Received invalid response from ipqualityscore` });
      }

      const isRegistered = await getIsRegistered(req.params.number);

      if (isRegistered) {
        console.log(
          `Number has been registered already. Number: ${req.params.number}. sessionId: ${req.params.sessionId}`
        );

        await failPhoneSession(
          req.params.sessionId,
          "Number has been registered already"
        )

        return res
          .status(400)
          .send({ error: "Number has been registered already!" });
      }

      const isSafe = response.data.fraud_score <= MAX_FRAUD_SCORE;

      if (!isSafe) {
        console.log(
          `Phone number ${req.params.number} could not be determined to belong to a unique human`
        );
        return res.status(400).send({
          error: `Phone number could not be determined to belong to a unique human. sessionId: ${req.params.sessionId}`,
        });
      }

      const creds = await new Promise((resolve, reject) => {
        credsFromNumber(req.params.number).then(resolve).catch(reject);
      });

      await setPhoneSessionIssued(req.params.sessionId);

      // Allow disabling of Sybil resistance for testing this script can be tested more than once ;)
      if (!process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING) {
        addNumber(req.params.number);
      }

      return res.send(creds);
    } catch (err) {
      console.log(
        `getCredentials v4: error for session ${req.params.sessionId}`,
        err
      );

      // We do not set session status to VERIFICATION_FAILED if the error was simply
      // due to rate limiting requests from the user's country or if user inputted incorrect
      // OTP.
      if (err.message !== ERROR_MESSAGES.OTP_DOES_NOT_MATCH) {
        await failPhoneSession(req.params.sessionId, err.message)
      }

      if (err.message === ERROR_MESSAGES.OTP_NOT_FOUND) {
        return res.status(400).send({ error: ERROR_MESSAGES.OTP_NOT_FOUND });
      }
      if (err.message === ERROR_MESSAGES.OTP_DOES_NOT_MATCH) {
        return res
          .status(400)
          .send({ error: ERROR_MESSAGES.OTP_DOES_NOT_MATCH });
      }

      res.status(500).send({
        error: `An unknown error occurred. Could not verify number with given code. sessionId: ${req.params.sessionId}`,
      });
    }
  }
);

/**
 * v5 is the same as v4, but it uses the no-Merkle-tree credential scheme from Holonym v3. (The
 * version numbers for these API endpoints do not correspond to the versions numbers for Holonym.)
 *
 * Checks that user-provided code is the one that was sent to number, and if so, and if number is safe and not used before, returns credentials
 */
app.get(
  "/getCredentials/v5/:number/:code/:country/:sessionId/:nullifier",
  async (req, res) => {
    req.setTimeout(10000);
    console.log("getCredentials v5 was called for number", req.params.number);

    const issuanceNullifier = req.params.nullifier;

    try {
      const session = await getPhoneSessionById(req.params.sessionId);

      if (!session) {
        return res.status(400).send("Invalid sessionId");
      }

      if (session.Item.sessionStatus.S !== sessionStatusEnum.IN_PROGRESS) {
        if (
          session.Item.sessionStatus.S === sessionStatusEnum.VERIFICATION_FAILED
        ) {
          return res.status(400).send({
            error: `Session status is ${
              session.Item.sessionStatus.S
            }. Expected ${sessionStatusEnum.IN_PROGRESS}. Failure reason: ${
              session.Item?.failureReason?.S ?? "Unknown"
            }`,
          });
        }
        return res.status(400).send({
          error: `Session status is ${session.Item.sessionStatus.S}. Expected ${sessionStatusEnum.IN_PROGRESS}.`,
        });
      }

      const result = await verify(req.params.number, req.params.code);

      if (!result) {
        await failPhoneSession(
          req.params.sessionId,
          "Could not verify number with given code"
        )

        return res
          .status(400)
          .send({ error: "Could not verify number with given code" });
      }

      const response = await axios.get(
        `https://ipqualityscore.com/api/json/phone/${process.env.IPQUALITYSCORE_APIKEY}/${req.params.number}?country[]=${req.params.country}`
      );
      if (!("fraud_score" in response?.data)) {
        console.error(`Invalid response: ${JSON.stringify(response)}`);
        return res
          .status(500)
          .send({ error: "Received invalid response from ipqualityscore" });
      }

      const isRegistered = await getIsRegisteredWithinLast11Months(
        req.params.number
      );

      if (isRegistered) {
        console.log(
          `Number has been registered already. Number: ${req.params.number}. sessionId: ${req.params.sessionId}`
        );

        await failPhoneSession(
          req.params.sessionId,
          "Number has been registered already"
        )

        return res.status(400).send({
          error: "Number has been registered already!",
        });
      }

      const isSafe = response.data.fraud_score <= MAX_FRAUD_SCORE;

      if (!isSafe) {
        console.log(
          `Phone number ${req.params.number} could not be determined to belong to a unique human`
        );
        return res.status(400).send({
          error: `Phone number could not be determined to belong to a unique human. sessionId: ${req.params.sessionId}`,
        });
      }

      const phoneNumber = req.params.number.replace("+", "");
      const creds = JSON.parse(
        issuev2(PRIVKEY, issuanceNullifier, phoneNumber, "0")
      );

      await setPhoneSessionIssued(req.params.sessionId);

      // Allow disabling of Sybil resistance for testing this script can be tested more than once ;)
      if (!process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING) {
        addNumber(req.params.number);
      }

      return res.send(creds);
    } catch (err) {
      console.log(
        `getCredentials v5: error for session ${req.params.sessionId}`,
        err
      );

      // We do not set session status to VERIFICATION_FAILED if the error was simply
      // due to rate limiting requests from the user's country or if user inputted incorrect
      // OTP.
      if (err.message !== ERROR_MESSAGES.OTP_DOES_NOT_MATCH) {
        await failPhoneSession(
          req.params.sessionId,
          err.message
        )
      }

      if (err.message === ERROR_MESSAGES.OTP_NOT_FOUND) {
        return res.status(400).send({ error: ERROR_MESSAGES.OTP_NOT_FOUND });
      }
      if (err.message === ERROR_MESSAGES.OTP_DOES_NOT_MATCH) {
        return res
          .status(400)
          .send({ error: ERROR_MESSAGES.OTP_DOES_NOT_MATCH });
      }

      res.status(500).send({
        error: `An unknown error occurred. Could not verify number with given code. sessionId: ${req.params.sessionId}`,
      });
    }
  }
);

/**
 * v6 is similar to v5, except it allows a user to get their signed credentials again
 * up to 5 days after initial issuance if they provide the same nullifier
 */
app.get(
  "/getCredentials/v6/:number/:code/:country/:sessionId/:nullifier",
  async (req, res) => {
    req.setTimeout(10000);
    console.log("getCredentials v6 was called for number", req.params.number);

    const issuanceNullifier = req.params.nullifier;
    const sessionId = req.params.sessionId;

    try {
      const _number = BigInt(issuanceNullifier)
    } catch (err) {
      return res.status(400).json({
        error: `Invalid issuance nullifier (${issuanceNullifier}). It must be a number`
      });
    }

    try {
      const session = await getPhoneSessionById(sessionId);

      if (!session) {
        return res.status(400).send("Invalid sessionId");
      }

      if (
        session.Item.sessionStatus.S === sessionStatusEnum.VERIFICATION_FAILED
      ) {
        return res.status(400).send({
          error: `Session status is ${
            session.Item.sessionStatus.S
          }. Expected ${sessionStatusEnum.IN_PROGRESS}. Failure reason: ${
            session.Item?.failureReason?.S ?? "Unknown"
          }`,
        });
      }

      // First, check if the user is looking up their credentials using their nullifier
      const phoneByNullifierResult = await getNullifierAndCredsByNullifier(issuanceNullifier)
      const phoneByNullifier = phoneByNullifierResult?.Item?.phoneNumber?.S
      const createdAt = phoneByNullifierResult?.Item?.createdAt?.N
      if (phoneByNullifier && timestampIsWithinLast5Days(createdAt)) {
        console.log('getCredentials/v6: Got phone number from nullifier lookup')
        const isRegistered = await getIsRegisteredWithinLast11MonthsAndNotLast5Days(phoneByNullifier)
      
        if (isRegistered) {
          console.log(
            `Number has been registered already. Number: ${phoneByNullifier}. sessionId: ${sessionId}`
          );
  
          await failPhoneSession(sessionId, "Number has been registered already")
  
          return res.status(400).send({
            error: "Number has been registered already!",
          });
        }

        // Note that we don't need to validate the phone number again.

        const phoneNumber = phoneByNullifier.replace("+", "");
        const creds = JSON.parse(
          issuev2(PRIVKEY, issuanceNullifier, phoneNumber, "0")
        );

        await setPhoneSessionIssued(sessionId);  

        if (!process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING) {
          addNumber(phoneByNullifier);
        }

        return res.send(creds);
      }

      if (session.Item.sessionStatus.S !== sessionStatusEnum.IN_PROGRESS) {
        return res.status(400).send({
          error: `Session status is ${session.Item.sessionStatus.S}. Expected ${sessionStatusEnum.IN_PROGRESS}.`,
        });
      }

      const result = await verify(req.params.number, req.params.code);

      if (!result) {
        await failPhoneSession(sessionId, "Could not verify number with given code")

        return res
          .status(400)
          .send({ error: "Could not verify number with given code" });
      }

      const isRegistered = await getIsRegisteredWithinLast11Months(
        req.params.number
      );

      if (isRegistered) {
        console.log(
          `Number has been registered already. Number: ${req.params.number}. sessionId: ${sessionId}`
        );

        await failPhoneSession(sessionId, "Number has been registered already")

        return res.status(400).send({
          error: "Number has been registered already!",
        });
      }

      const response = await axios.get(
        `https://ipqualityscore.com/api/json/phone/${process.env.IPQUALITYSCORE_APIKEY}/${req.params.number}?country[]=${req.params.country}`
      );
      if (!("fraud_score" in response?.data)) {
        console.error(`Invalid response: ${JSON.stringify(response)}`);
        return res
          .status(500)
          .send({ error: "Received invalid response from ipqualityscore" });
      }

      const isSafe = response.data.fraud_score <= MAX_FRAUD_SCORE;

      if (!isSafe) {
        console.log(
          `Phone number ${req.params.number} could not be determined to belong to a unique human`
        );
        return res.status(400).send({
          error: `Phone number could not be determined to belong to a unique human. sessionId: ${sessionId}`,
        });
      }

      const phoneNumber = req.params.number.replace("+", "");
      const creds = JSON.parse(
        issuev2(PRIVKEY, issuanceNullifier, phoneNumber, "0")
      );

      await setPhoneSessionIssued(sessionId);

      // Allow disabling of Sybil resistance for testing this script can be tested more than once ;)
      if (!process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING) {
        addNumber(req.params.number);
      }

      await putNullifierAndCreds(issuanceNullifier, req.params.number);

      return res.send(creds);
    } catch (err) {
      console.log(`getCredentials v6: error for session ${sessionId}`, err);

      // We do not set session status to VERIFICATION_FAILED if the error was simply
      // due to rate limiting requests from the user's country or if user inputted incorrect
      // OTP.
      const acceptableErrors = [
        ERROR_MESSAGES.OTP_DOES_NOT_MATCH,
        ERROR_MESSAGES.TOO_MANY_ATTEMPTS_COUNTRY,
        ERROR_MESSAGES.TOO_MANY_ATTEMPTS_IP
      ]
      if (!acceptableErrors.includes(err.message)) {
        await failPhoneSession(sessionId, err.message)
      }

      if (err.message === ERROR_MESSAGES.OTP_NOT_FOUND) {
        return res.status(400).send({ error: ERROR_MESSAGES.OTP_NOT_FOUND });
      }
      if (err.message === ERROR_MESSAGES.OTP_DOES_NOT_MATCH) {
        return res
          .status(400)
          .send({ error: ERROR_MESSAGES.OTP_DOES_NOT_MATCH });
      }

      res.status(500).send({
        error: `An unknown error occurred. Could not verify number with given code. sessionId: ${req.params.sessionId}`,
      });
    }
  }
);

// Sends a new code to number (E.164 format e.g. +13109273149)
// app.get("/send/v3/:number", async (req, res) => {
//     console.log("sending to ", req.params.number)
//     const countryCode = getCountryFromPhoneNumber(req.params.number);
//     await begin(req.params.number, countryCode)
//     res.sendStatus(200)
// })

function getCountryFromPhoneNumber(phoneNumber) {
  try {
    const parsedPhoneNumber = PhoneNumber(phoneNumber);
    const countryCode = parsedPhoneNumber.country;

    return countryCode;
  } catch (err) {
    console.error("Error parsing phone number:", err);
    next(err.message);
  }
}

// Sends a new code to number (E.164 format e.g. +13109273149)
// app.get("/send/:number", (req, res) => {
//     // req.setTimeout(5000); // Will timeout if no response from Twilio after 5s
//     console.log("sending to ", req.params.number)
//     client.verify.v2.services(process.env.TWILIO_SERVICE_SID)
//                 .verifications
//                 .create({to: req.params.number, channel: "sms"})
//                 .then(() => {res.status(200);return;});

// })

// Checks that user-provided code is the one that was sent to number, and if so, and if number is safe and not used before, returns credentials
// app.get("/getCredentials/v2/:number/:code/:country/", (req, res, next) => {
//     req.setTimeout(10000); // Will timeout if no response from Twilio after 10s
//     console.log("getCredentials v2 was called ")
//     client.verify.v2.services(process.env.TWILIO_SERVICE_SID)
//             .verificationChecks
//             .create({to: req.params.number, code: req.params.code})
//             .then(verification => {
//                 if(verification.status !== "approved"){next("There was a problem verifying the number with the code provided")}
//                 registerAndGetCredentialsIfSafe("v2", req.params.number, req.params.country, next, (credentials)=>{res.send(credentials); return}, )
//             }).catch(err => {
//                 console.log('getCredentials v2: error', err)
//                 next("There was a problem verifying the number with the code provided")
//             });
// })

// Checks that user-provided code is the one that was sent to number, and if so, and if number is safe and not used before, returns credentials
// app.get("/getCredentials/v3/:number/:code/:country/", async (req, res, next) => {
//     req.setTimeout(10000);
//     console.log("getCredentials v3 was called for number",req.params.number)
//     let result = false;

//     try {
//         result = await verify(req.params.number, req.params.code)
//         if(result) {
//             registerAndGetCredentialsIfSafe("doesnt_matter", req.params.number, req.params.country, next, (credentials)=>{res.send(credentials); return})
//         }

//     } catch (err) {
//         console.log('getCredentials v3: error', err)
//         next(err.message)
//     }
// })

// Express error handling
app.use(function (err, req, res, next) {
  console.log("error: ", err);
  res.status(err.status || 500).send(err);
  return;
});

/* Functions */

async function credsFromNumber(phoneNumberWithPlus) {
  console.log("credsFromNumber was called with number ", phoneNumberWithPlus);
  const phoneNumber = phoneNumberWithPlus.replace("+", "");
  return issuev0(PRIVKEY, phoneNumber, "0");
}

function registerAndGetCredentialsIfSafe(
  version,
  phoneNumber,
  country,
  next,
  callback
) {
  // let credsFromNumber = version == "v2" ? credsFromNumberV2 : credsFromNumberDeprecating
  console.log("registerAndGetCredentialsIfSafe was called");
  assert(phoneNumber && country);
  try {
    registerIfSafe(phoneNumber, country, next, (isSafe) => {
      if (!isSafe) {
        console.log(
          `phone number ${phoneNumber} could not be determined to belong to a unique human`
        );
        next(
          "phone number could not be determined to belong to a unique human"
        );
      } else {
        credsFromNumber(phoneNumber).then((creds) => callback(creds));
      }
    });
  } catch (error) {
    console.error("error", error);
    next(error);
  }
}

function registerIfSafe(phoneNumber, country, next, callback) {
  try {
    assert(phoneNumber && country);
    axios
      .get(
        `https://ipqualityscore.com/api/json/phone/${process.env.IPQUALITYSCORE_APIKEY}/${phoneNumber}?country[]=${country}`
      )
      .then((response) => {
        if (!("fraud_score" in response?.data)) {
          next(`Invalid response: ${JSON.stringify(response)} `);
        }
        numberExists(phoneNumber, (err, result) => {
          console.log("is registered", result);
          if (result && !process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING) {
            next("Number has been registered already!");
            return;
          }
          // Allow disabling of Sybil resistance for testing this script can be tested more than once ;)
          if (!process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING) {
            addNumber(phoneNumber);
          }
          callback(response.data.fraud_score <= MAX_FRAUD_SCORE);
        });
      });
  } catch (err) {
    next(err);
  }
}

app.use("/sessions", sessionsRouter);
app.use("/admin", adminRouter);

/* - */
app.listen(port);
// holonym twilio number: +18312329705
