**Brand Website Analyser**

A Chrome extension that gives you a quick read on any Shopify store: average selling price, catalog size, price range, category mix and a "Brand DNA" classification. Open the popup on a store and the numbers appear in a few seconds.

I built it for competitive research on Indian D2C fashion and streetwear brands. Doing that by hand means scrolling a catalog and tallying products in a spreadsheet.

What it shows
Metric	What it tells you
ASP (average selling price)	Mean of each product's lowest variant price, with outliers removed
Product count	Total products in the catalog
Price range	Lowest and highest product price
Category breakdown	Products grouped into 8 buckets: Tshirts, Shirts, Hoodies & Sweatshirts, Bottoms, Co-ords, Jackets & Outerwear, Accessories, Footwear
Price positioning	Budget (under ₹1,000), Mid (₹1,000–2,500), Premium (₹2,500–6,000) or Luxury (₹6,000+), based on ASP
Category focus	Apparel, Footwear, Accessories or Lifestyle (when no single group makes up 70% of the catalog)
Brand DNA	An AI classification of the brand on four dimensions (see below)
Brand DNA

Brand DNA looks at product names, tags, category mix, ASP and price positioning, then classifies the brand on four dimensions:

Core type: Pop Culture Graphic, Indie Streetwear, Mass Streetwear, or Accessories / Culture
Aesthetic: Loud, Clean, Edgy, or Experimental
Graphic intensity: High, Medium, or Low
Product focus: Tees, Oversized Fits, Full Outfits, or Accessories

Each result comes with a confidence level (high, medium or low). You can override any dimension from a dropdown if you disagree with the call.

How it works
A content script checks whether the current page is a Shopify store (Shopify globals, meta tags, script and link URLs).
The background service worker fetches the store's public /products.json endpoint, 250 products per page, up to 20 pages.
The catalog is analysed locally:
Category bucketing: each product's product_type is matched against keyword lists, first match wins. Unrecognised and uncategorised types are left out of the breakdown.
Thin-bucket filter: categories with 3 or fewer products are excluded so one-off items don't skew the picture.
Outlier removal: prices outside 1.5 × IQR are dropped before computing ASP.
Results are cached for 30 minutes per store, so reopening the popup is instant. Rescan forces a fresh fetch.
A summary of the catalog is sent to Claude to produce the Brand DNA classification.

All product analysis happens in your browser. Only the catalog summary used for Brand DNA (product titles, tags, category counts, ASP) is sent out, and only to the Anthropic API.

Install (developer mode)

The extension isn't on the Chrome Web Store yet.

Download this repo (Code → Download ZIP) and unzip it, or clone it:
bash
   git clone https://github.com/<your-username>/shopify-brand-intel.git
Open chrome://extensions in Chrome.
Turn on Developer mode (top right).
Click Load unpacked and select the project folder.
Pin the extension, open any Shopify store, and click the icon.
Brand DNA setup

Brand DNA calls the Anthropic API and needs your own API key.

Get a key from the Anthropic Console.
Open the extension's settings and paste the key. It is stored locally in your browser (chrome.storage.local) and is never sent anywhere except the Anthropic API.

Without a key, everything else still works. Only the Brand DNA panel is unavailable.

Limitations
Relies on /products.json. Some Shopify stores disable or restrict it. In that case the extension shows an error.
Only Shopify stores. Other platforms aren't supported.
Catalog cap of 5,000 products (20 pages of 250).
Category buckets are tuned for Indian fashion and streetwear. Product types outside those keyword lists don't appear in the breakdown.
Price positioning thresholds are in INR. The currency is hardcoded to ₹.
Brand DNA is an AI judgement from product names and tags, not ground truth. Treat it as a starting point.
Tech

Chrome Extension (Manifest V3), vanilla JavaScript, Shopify's public storefront JSON, Anthropic API.

Roadmap
Multi-currency support
Compare two stores side by side
Export results to CSV
Configurable category buckets
Chrome Web Store release
