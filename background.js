// In-memory cache: baseUrl -> { data, timestamp }
const scanCache = {};
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_SHOPIFY_DATA') {
    const { baseUrl, forceRescan } = message;

    const cached = scanCache[baseUrl];
    if (!forceRescan && cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      sendResponse({ success: true, data: cached.data, fromCache: true });
      return true;
    }

    fetchAllShopifyProducts(baseUrl)
      .then(data => {
        scanCache[baseUrl] = { data, timestamp: Date.now() };
        sendResponse({ success: true, data, fromCache: false });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function fetchAllShopifyProducts(baseUrl) {
  let page = 1;
  let allProducts = [];
  const limit = 250;

  while (true) {
    const url = `${baseUrl}/products.json?limit=${limit}&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} — not a Shopify store or products endpoint blocked`);
    const json = await res.json();
    const products = json.products || [];
    allProducts = allProducts.concat(products);
    if (products.length < limit) break;
    page++;
    if (page > 20) break;
  }

  return analyzeProducts(allProducts);
}

function removeOutliers(prices) {
  if (prices.length < 4) return prices;
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  return sorted.filter(p => p >= lower && p <= upper);
}

// ─────────────────────────────────────────────
// CATEGORY BUCKETS — ordered, first match wins
// Each entry: { label, keys[] } where keys are
// substrings matched against lowercased product_type
// ─────────────────────────────────────────────
const BUCKETS = [
  {
    label: 'Tshirts',
    keys: [
      'tshirt', 't-shirt', 'tee', 't shirt',
      'graphic tee', 'graphic tshirt', 'oversized tshirt', 'oversized tee',
      'acid wash', 'printed tee', 'printed tshirt', 'basic tee', 'basic tshirt',
      'drop shoulder', 'boxy tee', 'boxy tshirt', 'half sleeve', 'round neck tee'
    ]
  },
  {
    label: 'Shirts',
    keys: [
      'shirt', 'casual shirt', 'formal shirt', 'flannel', 'overshirt',
      'linen shirt', 'cuban shirt', 'bowling shirt', 'oxford shirt',
      'half shirt', 'full shirt', 'camp collar', 'button up', 'button down'
    ]
  },
  {
    label: 'Hoodies & Sweatshirts',
    keys: [
      'hoodie', 'hoody', 'sweatshirt', 'crewneck', 'crew neck',
      'pullover', 'fleece', 'sweater', 'sweat shirt', 'oversized hoodie',
      'zip hoodie', 'half zip', 'quarter zip'
    ]
  },
  {
    label: 'Bottoms',
    keys: [
      'jogger', 'jogging', 'track pant', 'trackpant', 'track bottom',
      'cargo', 'trouser', 'pant', 'jean', 'denim', 'chino',
      'short', 'shorts', 'sweat pant', 'sweatpant', 'lounge pant',
      'bottom', 'lower', 'slim fit pant', 'wide leg'
    ]
  },
  {
    label: 'Co-ords',
    keys: [
      'co-ord', 'coord', 'co ord', 'set', 'matching set',
      'twin set', 'two piece', '2 piece', 'suit set'
    ]
  },
  {
    label: 'Jackets & Outerwear',
    keys: [
      'jacket', 'bomber', 'windbreaker', 'wind cheater', 'windcheater',
      'coat', 'blazer', 'varsity', 'puffer', 'gilet', 'vest jacket',
      'denim jacket', 'leather jacket', 'overshirt jacket', 'outerwear'
    ]
  },
  {
    label: 'Accessories',
    keys: [
      'cap', 'hat', 'beanie', 'bucket hat', 'snapback', 'trucker',
      'bag', 'tote', 'backpack', 'sling', 'pouch', 'fanny pack', 'wallet',
      'sock', 'socks', 'belt', 'lanyard', 'keychain', 'pin', 'patch',
      'mask', 'glove', 'scarf', 'accessory', 'accessories', 'add-on'
    ]
  },
  {
    label: 'Footwear',
    keys: [
      'shoe', 'sneaker', 'boot', 'sandal', 'slipper', 'loafer',
      'footwear', 'trainer', 'flip flop', 'mule', 'clog', 'heel'
    ]
  }
];

function bucketize(productType) {
  const lc = (productType || '').toLowerCase().trim();
  if (!lc || lc === 'uncategorized') return null; // exclude uncategorized

  for (const bucket of BUCKETS) {
    if (bucket.keys.some(k => lc.includes(k))) return bucket.label;
  }
  return null; // unrecognized — exclude from bucketed view
}

function analyzeProducts(products) {
  if (!products.length) return null;

  let rawPrices = [];
  let rawCategoryMap = {};   // original product_type → count (for categoryFocus)
  let bucketMap = {};        // bucketed label → count
  let bucketPrices = {};     // bucketed label → [prices] (for per-bucket ASP if needed)
  let productSummary = [];

  for (const product of products) {
    const variantPrices = (product.variants || [])
      .map(v => parseFloat(v.price))
      .filter(p => !isNaN(p) && p > 0);
    const minPrice = variantPrices.length ? Math.min(...variantPrices) : null;

    if (minPrice !== null) rawPrices.push(minPrice);

    const rawCat = product.product_type?.trim() || 'Uncategorized';
    rawCategoryMap[rawCat] = (rawCategoryMap[rawCat] || 0) + 1;

    const bucket = bucketize(rawCat);
    if (bucket) {
      bucketMap[bucket] = (bucketMap[bucket] || 0) + 1;
      if (minPrice !== null) {
        bucketPrices[bucket] = bucketPrices[bucket] || [];
        bucketPrices[bucket].push(minPrice);
      }
    }

    productSummary.push({
      title: product.title,
      type: rawCat,
      bucket: bucket || 'Other',
      tags: Array.isArray(product.tags) ? product.tags.join(',') : (product.tags || '')
    });
  }

  // Thin bucket threshold — exclude buckets with very few products
  const THIN_THRESHOLD = 3;

  // ASP: use prices from non-thin buckets only; fall back to all if needed
  const validBuckets = new Set(
    Object.entries(bucketMap)
      .filter(([, c]) => c > THIN_THRESHOLD)
      .map(([b]) => b)
  );

  let filteredPrices = [];
  for (const product of products) {
    const rawCat = product.product_type?.trim() || 'Uncategorized';
    const bucket = bucketize(rawCat);
    if (!bucket || !validBuckets.has(bucket)) continue;
    const variantPrices = (product.variants || [])
      .map(v => parseFloat(v.price))
      .filter(p => !isNaN(p) && p > 0);
    if (variantPrices.length) filteredPrices.push(Math.min(...variantPrices));
  }

  const pricesToUse = filteredPrices.length > 0 ? filteredPrices : rawPrices;
  const cleanPrices = removeOutliers(pricesToUse);

  const totalProducts = products.length;
  const asp = cleanPrices.length
    ? cleanPrices.reduce((a, b) => a + b, 0) / cleanPrices.length
    : 0;
  const minP = rawPrices.length ? Math.min(...rawPrices) : 0;
  const maxP = rawPrices.length ? Math.max(...rawPrices) : 0;

  // Categories = bucketed, thin filtered, sorted by count
  const thinExcludedCount = Object.values(bucketMap).filter(c => c <= THIN_THRESHOLD).length;
  const categories = Object.entries(bucketMap)
    .filter(([, c]) => c > THIN_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  let pricePosition;
  if (asp < 1000) pricePosition = 'Budget';
  else if (asp < 2500) pricePosition = 'Mid';
  else if (asp < 6000) pricePosition = 'Premium';
  else pricePosition = 'Luxury';

  return {
    totalProducts, asp, minPrice: minP, maxPrice: maxP,
    categories, currency: '₹', pricePosition, productSummary,
    outliersRemoved: rawPrices.length - cleanPrices.length,
    thinExcludedCount,
    categoryFocus: deriveCategoryFocus(bucketMap)
  };
}

function deriveCategoryFocus(bucketMap) {
  let apparelScore = 0, footwearScore = 0, accessoriesScore = 0;

  for (const [label, count] of Object.entries(bucketMap)) {
    if (label === 'Footwear') footwearScore += count;
    else if (label === 'Accessories') accessoriesScore += count;
    else apparelScore += count; // Tshirts, Shirts, Hoodies, Bottoms, Co-ords, Jackets
  }

  const total = apparelScore + footwearScore + accessoriesScore || 1;
  const ap = apparelScore / total;
  const fp = footwearScore / total;
  const acc = accessoriesScore / total;

  const dominance = Math.max(ap, fp, acc);
  if (dominance < 0.70) return 'Lifestyle';
  if (ap >= 0.70) return 'Apparel';
  if (fp >= 0.70) return 'Footwear';
  return 'Accessories';
}
