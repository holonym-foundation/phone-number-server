const assert = require("assert");
const axios = require('axios');
const {
  ethereumCMCID,
  fantomCMCID,
  avalancheCMCID,
  cmcIdToSlug,
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

// --------------------- Coinmarketcap stuff ---------------------
// TODO: Use redis instead. This is a temporary solution to avoid hitting
// CMC's rate limit. key-value pair is { slug: { price: number, lastUpdatedAt: Date } }
const cryptoPricesCache = {};

function getPriceFromCache(slug) {
  const now = new Date();
  const cachedPrice = cryptoPricesCache[slug];
  // If price was last updated less than 30 seconds ago, use cached price
  if (cachedPrice && now - cachedPrice.lastUpdatedAt < 30 * 1000) {
    return cachedPrice.price;
  }
}

function setPriceInCache(slug, price) {
  cryptoPricesCache[slug] = { price, lastUpdatedAt: new Date() };
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

/**
 * First, check the cache. If nothing in cache, query CMC, and update cache.
 */
async function getPriceFromCacheOrAPI(id) {
  const slug = cmcIdToSlug[id];
  const cachedPrice = getPriceFromCache(slug);
  if (cachedPrice) {
    return cachedPrice;
  }
  const resp = await getLatestCryptoPrice(id)
  const price = resp?.data?.data?.[id]?.quote?.USD?.price;
  setPriceInCache(slug, price);
  return price;
}

async function usdToETH(usdAmount) {
  const ethPrice = await getPriceFromCacheOrAPI(ethereumCMCID)
  const ethAmount = usdAmount / ethPrice;
  return ethAmount;
}

async function usdToFTM(usdAmount) {
  const fantomPrice = await getPriceFromCacheOrAPI(fantomCMCID)
  const ftmAmount = usdAmount / fantomPrice;
  return ftmAmount;
}

async function usdToAVAX(usdAmount) {
  const avalanchePrice = await getPriceFromCacheOrAPI(avalancheCMCID)
  const avaxAmount = usdAmount / avalanchePrice;
  return avaxAmount;
}

// --------------------- END: Coinmarketcap stuff ---------------------

/**
 * @param {() => Promise<T>} fn 
 * @param {number} retries 
 * @param {number} delay 
 */
async function retry(
  fn,
  retries,
  delay
) {
  try {
    return await fn()
  } catch (err) {
    if (retries === 0) {
      throw err
    }

    console.log('retry encountered error "', err.message, '" retries left:', retries)

    // console.log(`Retrying... Attempts left: ${retries}`)
    await new Promise((resolve) => setTimeout(resolve, delay))

    return await retry(fn, retries - 1, delay)
  }
}

/**
 * @param {number | undefined} timestamp 
 */
function timestampIsWithinLast5Days(timestamp) {
  if (!timestamp) return false
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  return timestamp >= fiveDaysAgo;
}

module.exports = { 
  getDateAsInt : getDateAsInt,
  usdToETH,
  usdToFTM,
  usdToAVAX,
  retry,
  timestampIsWithinLast5Days,
}
