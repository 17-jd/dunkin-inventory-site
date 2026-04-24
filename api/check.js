// Vercel serverless function — proxies Grubhub's public API so the
// browser doesn't hit CORS. Anonymous auth is minted per invocation.
//
// GET /api/check                 → all 21 stores
// GET /api/check?gh_id=2561073   → one store

const stores = require('../stores.json');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BASE_HEADERS = {
  'User-Agent': UA,
  Accept: 'application/json',
  Origin: 'https://www.grubhub.com',
  Referer: 'https://www.grubhub.com/',
};

async function authenticate() {
  const r = await fetch('https://api-gtm.grubhub.com/auth', {
    method: 'POST',
    headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brand: 'GRUBHUB',
      client_id: 'beta_UmWlpstzQSFmocLy3h1UieYcVST',
      device_id: 'vercel-probe',
      scope: 'anonymous',
    }),
  });
  if (!r.ok) throw new Error(`auth failed: ${r.status}`);
  const d = await r.json();
  return d.session_handle.access_token;
}

async function fetchStore(store, token) {
  const params = new URLSearchParams({
    hideUnavailable: 'false',
    hideChoiceCategories: 'false',
    version: '4',
    orderType: 'standard',
  });
  const url = `https://api-gtm.grubhub.com/restaurants/${store.gh_id}?${params}`;
  const r = await fetch(url, {
    headers: { ...BASE_HEADERS, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    return { ...store, error: `HTTP ${r.status}`, open: null };
  }
  const data = await r.json();
  const rest = data.restaurant || {};
  const avail = data.restaurant_availability || {};

  let itemsTotal = 0;
  let itemsUnavail = 0;
  let variantsTotal = 0;
  let variantsUnavail = 0;
  const unavailItems = [];
  const unavailVariants = [];
  const donutFlavors = [];

  for (const cat of rest.menu_category_list || []) {
    const isDonuts = /donut/i.test(cat.name || '');
    for (const item of cat.menu_item_list || []) {
      itemsTotal++;
      if (item.unavailable) {
        itemsUnavail++;
        unavailItems.push(item.name);
      }
      for (const cc of item.choice_category_list || []) {
        for (const co of cc.choice_option_list || []) {
          variantsTotal++;
          if (co.unavailable) {
            variantsUnavail++;
            unavailVariants.push(
              `${item.name} / ${co.description || co.name || '?'}`
            );
          }
          if (isDonuts && /flavor/i.test(cc.name || '')) {
            donutFlavors.push({
              name: co.description || co.name,
              available: !co.unavailable,
            });
          }
        }
      }
    }
  }

  return {
    pc: store.pc,
    address: store.address,
    city: store.city,
    zip: store.zip,
    gh_id: store.gh_id,
    open: avail.open === true,
    itemsTotal,
    itemsUnavail,
    variantsTotal,
    variantsUnavail,
    unavailItems: unavailItems.slice(0, 30),
    unavailVariants: unavailVariants.slice(0, 30),
    donutFlavors,
    deliveryEstimate: avail.delivery_estimate_range_v2 || null,
    pickupEstimate: avail.pickup_estimate_range_v2 || null,
  };
}

module.exports = async (req, res) => {
  const started = Date.now();
  try {
    const token = await authenticate();
    const { gh_id } = req.query || {};
    let live;
    if (gh_id) {
      live = stores.filter((s) => String(s.gh_id) === String(gh_id));
      if (live.length === 0) {
        res.status(404).json({ error: `gh_id ${gh_id} not in fleet` });
        return;
      }
    } else {
      live = stores.filter((s) => s.gh_id);
    }
    const results = await Promise.all(
      live.map((s) =>
        fetchStore(s, token).catch((e) => ({ ...s, error: String(e) }))
      )
    );
    const fleet = {
      total: results.length,
      open: results.filter((s) => s.open).length,
      closed: results.filter((s) => s.open === false).length,
      errored: results.filter((s) => s.error).length,
      withIssues: results.filter(
        (s) => (s.itemsUnavail || 0) > 0 || (s.variantsUnavail || 0) > 0
      ).length,
    };
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    res.status(200).json({
      fetched_at: new Date().toISOString(),
      elapsed_ms: Date.now() - started,
      fleet,
      stores: results,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
