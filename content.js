// Detect if this is a Shopify store
function detectShopify() {
  // Check for Shopify globals
  if (window.Shopify) return true;
  // Check meta tags
  const metas = document.querySelectorAll('meta');
  for (const meta of metas) {
    if (meta.content && meta.content.toLowerCase().includes('shopify')) return true;
  }
  // Check for common Shopify script patterns
  const scripts = document.querySelectorAll('script[src]');
  for (const s of scripts) {
    if (s.src.includes('shopify') || s.src.includes('cdn.shop')) return true;
  }
  // Check link tags
  const links = document.querySelectorAll('link[href]');
  for (const l of links) {
    if (l.href.includes('shopify')) return true;
  }
  return false;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_SHOPIFY') {
    sendResponse({
      isShopify: detectShopify(),
      baseUrl: `${window.location.protocol}//${window.location.hostname}`
    });
  }
});
