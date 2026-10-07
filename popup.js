const $ = id => document.getElementById(id);

function showState(name) {
  ['stateIdle','stateNotShopify','stateLoading','stateError','stateResults'].forEach(s => {
    $(s).classList.remove('active');
  });
  $(name).classList.add('active');
}

function fmt(n, currency) {
  return `${currency}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function runScan(forceRescan = false) {
  $('scanBtn').disabled = true;
  $('loadingLabel').textContent = forceRescan ? 'Fetching catalog…' : 'Loading results…';
  $('loadingPages').textContent = forceRescan ? 'Connecting to store…' : 'Checking cache…';
  showState('stateLoading');

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) { showError('Could not access the current tab.'); return; }

    chrome.tabs.sendMessage(tab.id, { type: 'CHECK_SHOPIFY' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }, () => {
          chrome.tabs.sendMessage(tab.id, { type: 'CHECK_SHOPIFY' }, (resp2) => {
            if (!resp2) {
              // On auto-open (no force), quietly show idle state if page not accessible
              if (!forceRescan) { showState('stateIdle'); $('scanBtn').disabled = false; return; }
              showError('Cannot access this page.\nTry reloading the tab first.');
              return;
            }
            handleShopifyCheck(resp2, tab, forceRescan);
          });
        });
        return;
      }
      handleShopifyCheck(response, tab, forceRescan);
    });
  });
}

function handleShopifyCheck(response, tab, forceRescan) {
  const baseUrl = response.baseUrl;
  $('loadingPages').textContent = forceRescan ? 'Fetching all products…' : 'Loading cached data…';
  const start = Date.now();

  chrome.runtime.sendMessage({ type: 'FETCH_SHOPIFY_DATA', baseUrl, forceRescan }, (res) => {
    if (chrome.runtime.lastError) { showError('Extension error: ' + chrome.runtime.lastError.message); return; }
    if (!res?.success) { showError(res?.error || 'Failed to fetch products.'); return; }
    if (!res.data) { showError('No products found on this store.'); return; }

    const elapsed = res.fromCache ? null : ((Date.now() - start) / 1000).toFixed(1);
    renderResults(res.data, baseUrl, tab, elapsed, res.fromCache);
  });
}

function renderResults(data, baseUrl, tab, elapsed, fromCache) {
  const { totalProducts, asp, minPrice, maxPrice, categories, currency, pricePosition, productSummary, outliersRemoved, thinExcludedCount, categoryFocus } = data;

  const hostname = new URL(baseUrl).hostname.replace('www.', '');
  $('storeName').textContent = tab?.title?.split('–')[0]?.split('|')[0]?.trim() || hostname;

  $('aspValue').textContent = fmt(asp, currency);
  let aspSubParts = [];
  if (outliersRemoved > 0) aspSubParts.push(`excl. ${outliersRemoved} outlier${outliersRemoved > 1 ? 's' : ''}`);
  if (thinExcludedCount > 0) aspSubParts.push(`${thinExcludedCount} thin cat${thinExcludedCount > 1 ? 's' : ''} excluded`);
  $('aspSub').textContent = aspSubParts.length ? aspSubParts.join(' · ') : 'per product';

  $('productCount').textContent = totalProducts.toLocaleString();
  $('categoryCount').textContent = categories.length;
  if (thinExcludedCount > 0) {
    $('categoryCount').title = `${thinExcludedCount} thin categories (≤3 products) excluded`;
  }
  $('prMin').textContent = fmt(minPrice, currency);
  $('prMax').textContent = fmt(maxPrice, currency);

  if (fromCache) {
    $('scanTime').textContent = 'Loaded from cache · Click Rescan to refresh';
  } else if (elapsed) {
    $('scanTime').textContent = `Scanned in ${elapsed}s`;
  }

  // Category bars
  const catList = $('catList');
  catList.innerHTML = '';
  const maxCount = categories[0]?.count || 1;
  categories.forEach((cat, i) => {
    const pct = Math.round((cat.count / maxCount) * 100);
    const row = document.createElement('div');
    row.className = 'cat-row';
    row.style.animationDelay = `${0.1 + i * 0.06}s`;
    row.innerHTML = `
      <div class="cat-name" title="${cat.name}">${cat.name}</div>
      <div class="cat-bar-wrap"><div class="cat-bar" style="width:${pct}%"></div></div>
      <div class="cat-count">${cat.count}</div>
    `;
    catList.appendChild(row);
  });

  // Price positioning pills
  ['Budget','Mid','Premium','Luxury'].forEach(p => {
    const el = $('pp' + p);
    el.className = 'price-pill';
    if (p === pricePosition) el.classList.add('active-' + p.toLowerCase());
  });

  // Category Focus pills
  ['Apparel','Footwear','Accessories','Lifestyle'].forEach(f => {
    const el = $('cf' + f);
    el.className = 'focus-pill';
    if (f === categoryFocus) el.classList.add('active-' + f.toLowerCase());
  });

  // Show results, kick off Brand DNA
  showState('stateResults');
  $('scanBtn').disabled = false;
  $('dnaLoading').style.display = 'flex';
  $('dnaContent').style.display = 'none';
  $('dnaConfidence').textContent = '';

  analyzeBrandDNA(productSummary, categories, asp, pricePosition);
}

async function analyzeBrandDNA(productSummary, categories, asp, pricePosition) {
  try {
    const sampleTitles = productSummary.slice(0, 80).map(p => p.title).join(', ');
    const catSummary = categories.map(c => `${c.name}(${c.count})`).join(', ');
    const allTags = [...new Set(
      productSummary.flatMap(p => p.tags.split(',').map(t => t.trim().toLowerCase()))
    )].filter(Boolean).slice(0, 60).join(', ');

    const prompt = `You are analyzing an Indian D2C streetwear/fashion brand's Shopify store. Based on the data below, classify this brand across 4 dimensions. Respond ONLY with valid JSON, no markdown, no explanation.\n\nStore data:\n- Product count: ${productSummary.length}\n- Categories: ${catSummary}\n- ASP: ₹${Math.round(asp)}\n- Price positioning: ${pricePosition}\n- Sample product names: ${sampleTitles}\n- Common tags: ${allTags}\n\nRespond with this exact JSON structure:\n{\n  "coreType": one of ["Pop Culture Graphic", "Indie Streetwear", "Mass Streetwear", "Accessories / Culture"],\n  "aesthetic": one of ["Loud", "Clean", "Edgy", "Experimental"],\n  "graphicIntensity": one of ["High", "Medium", "Low"],\n  "productFocus": one of ["Tees", "Oversized Fits", "Full Outfits", "Accessories"],\n  "confidence": one of ["high", "medium", "low"],\n  "reasoning": "one sentence explaining the classification"\n}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) throw new Error('API error ' + response.status);
    const apiData = await response.json();
    const raw = apiData.content?.map(b => b.text || '').join('') || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const dna = JSON.parse(clean);

    $('dnaCoreValue').textContent = dna.coreType;
    $('dnaAestheticValue').textContent = dna.aesthetic;
    $('dnaGraphicValue').textContent = dna.graphicIntensity;
    $('dnaFocusValue').textContent = dna.productFocus;

    setSelectValue('dnaCoreSelect', dna.coreType);
    setSelectValue('dnaAestheticSelect', dna.aesthetic);
    setSelectValue('dnaGraphicSelect', dna.graphicIntensity);
    setSelectValue('dnaFocusSelect', dna.productFocus);

    ['Core','Aesthetic','Graphic','Focus'].forEach(key => {
      const sel = $(`dna${key}Select`);
      const val = $(`dna${key}Value`);
      sel.addEventListener('change', () => { val.textContent = sel.value; });
    });

    const conf = $('dnaConfidence');
    conf.textContent = dna.confidence.toUpperCase() + ' CONFIDENCE';
    conf.className = 'dna-confidence ' + dna.confidence;

    $('dnaLoading').style.display = 'none';
    $('dnaContent').style.display = 'block';

  } catch (err) {
    $('dnaLoading').innerHTML = `<span style="color:var(--muted);font-size:10px">Brand DNA unavailable (${err.message})</span>`;
  }
}

function setSelectValue(id, value) {
  const sel = $(id);
  for (let i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === value || sel.options[i].text === value) {
      sel.selectedIndex = i;
      break;
    }
  }
}

function showError(msg) {
  $('errorMsg').textContent = msg;
  showState('stateError');
  $('scanBtn').disabled = false;
}

document.addEventListener('DOMContentLoaded', () => {
  $('scanBtn').addEventListener('click', () => runScan(true));
  $('rescanBtn').addEventListener('click', () => runScan(true));

  // Auto-load on popup open (uses cache if available, shows idle if no cache)
  runScan(false);
});
