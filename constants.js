const { ethers } = require('ethers');

const sessionStatusEnum = {
  NEEDS_PAYMENT: "NEEDS_PAYMENT",
  IN_PROGRESS: "IN_PROGRESS",
  ISSUED: "ISSUED",
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
  REFUNDED: "REFUNDED",
};

const maxAttemptsPerSession = 3;

const supportedChainIds = [
  1, // Ethereum
  10, // Optimism
  250, // Fantom
  8453, // Base
  43114, // Avalanche
  1313161554, // Aurora
];
if (process.env.NODE_ENV === "development") {
  supportedChainIds.push(420); // Optimism goerli
}

// NOTE: This const must stay in sync with the frontend.
// We use the same account that we use for id-server.
const idServerPaymentAddress = "0xdca2e9ae8423d7b0f94d7f9fc09e698a45f3c851";

// const ethereumProvider = new ethers.providers.AlchemyProvider(
//   "homestead",
//   process.env.ALCHEMY_APIKEY
// );
// const optimismProvider = new ethers.providers.AlchemyProvider(
//   "optimism",
//   process.env.ALCHEMY_APIKEY
// );
// const optimismGoerliProvider = new ethers.providers.AlchemyProvider(
//   "optimism-goerli",
//   process.env.ALCHEMY_APIKEY
// );
const ethereumProvider = new ethers.providers.JsonRpcProvider(
  process.env.ETHEREUM_RPC_URL
);
const optimismProvider = new ethers.providers.JsonRpcProvider(
  process.env.OPTIMISM_RPC_URL
);
const optimismGoerliProvider = new ethers.providers.JsonRpcProvider(
  process.env.OPTIMISM_GOERLI_RPC_URL
);
const baseProvider = new ethers.providers.JsonRpcProvider(
  process.env.BASE_RPC_URL
);
const fantomProvider = new ethers.providers.JsonRpcProvider(
  "https://rpc.ftm.tools"
);
const avalancheProvider = new ethers.providers.JsonRpcProvider(
  "https://api.avax.network/ext/bc/C/rpc"
);
const auroraProvider = new ethers.providers.JsonRpcProvider(
  'https://mainnet.aurora.dev'
);

const ethereumCMCID = 1027;
const avalancheCMCID = 5805;
const fantomCMCID = 3513;

const cmcSlugToID = {
  ethereum: ethereumCMCID,
  avalanche: avalancheCMCID,
  fantom: fantomCMCID,
};

const ERROR_MESSAGES = {
  OTP_NOT_FOUND: 'OTP not found',
  OTP_DOES_NOT_MATCH: 'OTP does not match',
}
const payPalApiUrlBase =
  process.env.NODE_ENV === "production"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

module.exports = {
  sessionStatusEnum,
  maxAttemptsPerSession,
  supportedChainIds,
  idServerPaymentAddress,
  ethereumProvider,
  optimismProvider,
  optimismGoerliProvider,
  baseProvider,
  fantomProvider,
  avalancheProvider,
  auroraProvider,
  ethereumCMCID,
  fantomCMCID,
  avalancheCMCID,
  cmcSlugToID,
  ERROR_MESSAGES,
  payPalApiUrlBase,
}
