const assert = require("assert");
const axios = require('axios');
const {
  ethereumCMCID,
  fantomCMCID,
  avalancheCMCID,
} = require('./constants.js');

function getDateAsInt(date) {
    // Format input
    const [year, month, day] = date.split("-");
    assert.ok(year && month && day); // Make sure Y M D all given
    assert.ok((year >= 1900) && (year <= 2099)); // Make sure date is in a reasonable range, otherwise it's likely the input was malformatted and it's best to be safe by stopping -- we can always allow more edge cases if needed later 
    const time = (new Date(date)).getTime() / 1000 + 2208988800 // 2208988800000 is 70 year offset; Unix timestamps below 1970 are negative and we want to allow from approximately 1900. 
    assert.ok(!isNaN(time));
    return time;
  }


function getLatestCryptoPrice(id) {
  return axios.get(
    `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?id=${id}`,
    {
      headers: {
        "X-CMC_PRO_API_KEY": process.env.CMC_API_KEY,
        Accept: "application/json",
      },
    }
  );
}

async function usdToETH(usdAmount) {
  const resp = await getLatestCryptoPrice(ethereumCMCID);
  const ethPrice = resp?.data?.data?.[ethereumCMCID]?.quote?.USD?.price;
  const ethAmount = usdAmount / ethPrice;
  return ethAmount;
}

async function usdToFTM(usdAmount) {
  const resp = await getLatestCryptoPrice(fantomCMCID);
  const fantomPrice = resp?.data?.data?.[fantomCMCID]?.quote?.USD?.price;
  const ftmAmount = usdAmount / fantomPrice;
  return ftmAmount;
}

async function usdToAVAX(usdAmount) {
  const resp = await getLatestCryptoPrice(avalancheCMCID);
  const avalanchePrice = resp?.data?.data?.[avalancheCMCID]?.quote?.USD?.price;
  const avaxAmount = usdAmount / avalanchePrice;
  return avaxAmount;
}

module.exports = { 
  getDateAsInt : getDateAsInt,
  usdToETH,
  usdToFTM,
  usdToAVAX,
}
