const express = require("express");
const {
  updatePhoneSession,
  getPhoneSessionById,
  getPhoneSessionsBySigDigest,
  getPhoneSessionByTxHash,
} = require('./dynamodb.js');
const {
  sessionStatusEnum,
} = require('./constants.js');

/**
 * ENDPOINT.
 * 
 * Returns all sessions that belong to a user.
 */
async function userSessions(req, res) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    const id = req.body.id;
    const txHash = req.body.txHash;

    if (!id && !txHash) {
      return res.status(400).json({ error: "id or txHash is required" });
    }

    let sessions = [];

    if (id) {
      const session = await getPhoneSessionById(id);

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const data = await getPhoneSessionsBySigDigest(session.Item.sigDigest.S);
      sessions = data.Items;
    }

    if (txHash) {
      const session = await getPhoneSessionByTxHash(txHash);

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const data = await getPhoneSessionsBySigDigest(session.sigDigest.S);
      sessions = data.Items;
    }

    return res.status(200).json(
      sessions.map((session) => ({
        id: session.id.S,
        sessionStatus: session.sessionStatus.S,
        txHash: session.txHash?.S,
        chainId: session.chainId?.N,
        refundTxHash: session.refundTxHash?.S,
        numAttempts: session.numAttempts.N,
        payPal: session?.payPal?.S,
      }))
    );
  } catch (err) {
    console.log("admin/user-sessions: Error:", err.message);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * ENDPOINT.
 * 
 * Set a session's status to failed.
 */
async function failSession(req, res) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    const id = req.body.id;

    if (!id) {
      return res.status(400).json({ error: "id is required in request body" });
    }

    const session = await getPhoneSessionById(id);

    if (!session?.Item) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (
      session.Item.sessionStatus.S !== sessionStatusEnum.IN_PROGRESS &&
      session.Item.sessionStatus.S !== sessionStatusEnum.ISSUED
    ) {
      return res.status(400).json({ 
        error: `Session status is ${session.Item.sessionStatus.S}. Expected ${sessionStatusEnum.IN_PROGRESS}.`
      });
    }

    await updatePhoneSession(
      id,
      null,
      sessionStatusEnum.VERIFICATION_FAILED,
      null,
      null,
      null,
      null,
      null,
      "Unknown"
    )

    return res.status(200).json({
      success: true
    });
  } catch (err) {
    console.log("admin/fail-session: Error:", err.message);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

const adminRouter = express.Router();

adminRouter.post("/user-sessions", userSessions);
adminRouter.post("/fail-session", failSession);

module.exports.adminRouter = adminRouter;
