// Shipping quote helper (Shippo)
import dotenv from "dotenv";
import { shippoClient } from "../shippoClient.js";
import supabase from "../../supabaseClient.js"; // ⬅️ NEW: DB lookup for weights/dims

dotenv.config();
// Override constants from environment when provided
const HANDLING_FEE = (() => {
  const v = Number(process.env.HANDLING_FEE);
  return Number.isFinite(v) ? v : 10;
})();
const DEFAULT_ITEM_WEIGHT_OZ = (() => {
  const v = Number(process.env.DEFAULT_ITEM_WEIGHT_OZ);
  return Number.isFinite(v) ? v : 12;
})();

if (!process.env.SHIP_FROM_EMAIL || !process.env.SHIP_FROM_PHONE) {
  console.warn("⚠️ SHIP_FROM_EMAIL or SHIP_FROM_PHONE missing – USPS labels may fail (sender_info_missing).");
}

function assertClient() {
  if (!shippoClient) throw new Error("Shippo client not initialized (missing API key or constructor failure)");
  return shippoClient;
}

// Helper to normalize state input
function normalizeState(state) {
  if (!state) return "";
  const s = state.trim().toUpperCase();
  if (s.length === 2) return s; // already 2-letter
  const map = { CALIFORNIA: "CA" };
  return map[s] || s;
}

// Support id/productId/product_id as the key
function itemKey(it) {
  return String(it?.id ?? it?.productId ?? it?.product_id ?? "");
}

/** ───────────────────────────────────────────────────────────────
 *  Option A: hydrate items (by product id) with weight/dims from DB
 *  Looks up product.weight_oz/length_in/width_in/height_in
 *  so the frontend doesn't have to send them.
 *  ─────────────────────────────────────────────────────────────── */
async function hydrateItemsWithDb(items) {
  try {
    const ids = Array.from(new Set((items || []).map(itemKey).filter(Boolean)));
    if (!ids.length) return items || [];

    const { data, error } = await supabase
      .from("product")
      .select("id, weight_oz, length_in, width_in, height_in")
      .in("id", ids);
    if (error) {
      console.warn("⚠️ hydrateItemsWithDb: supabase error", error);
      return items || [];
    }
    const byId = new Map((data || []).map(r => [String(r.id), r]));

    return (items || []).map(it => {
      const row = byId.get(itemKey(it));
      return {
        ...it,
        // if cart has it, use it; else DB; else default
        weightOz: it?.weightOz ?? (row?.weight_oz ?? DEFAULT_ITEM_WEIGHT_OZ),
        lengthIn: it?.lengthIn ?? (row?.length_in ?? undefined),
        widthIn:  it?.widthIn  ?? (row?.width_in  ?? undefined),
        heightIn: it?.heightIn ?? (row?.height_in ?? undefined),
      };
    });
  } catch (e) {
    console.warn("⚠️ hydrateItemsWithDb failed:", e?.message || e);
    return items || [];
  }
}

/** ───────────────────────────────────────────────────────────────
 *  Parcel builder (billable weight)
 *  - sums per-item weight (oz) × qty
 *  - adds packaging tare
 *  - enforces minimum billable
 *  - uses simple box that grows if bigger dims exist
 *  ─────────────────────────────────────────────────────────────── */
const OZ_PER_LB = 16;
const DIM_DIVISOR = 139; // in^3 per lb (common divisor)

function toOz(value, unit = "oz") {
  const v = Number(value) || 0;
  const u = String(unit).toLowerCase();
  if (u === "oz") return v;
  if (u === "lb" || u === "lbs") return v * OZ_PER_LB;
  if (u === "g" || u === "gram" || u === "grams") return v / 28.349523125;
  if (u === "kg" || u === "kgs") return v * 35.27396195;
  return v;
}

function buildParcelFromItems(items = [], opts = {}) {
  const packagingTareOz = opts.packagingTareOz ?? 8; // box + tape + label + filler
  const minOz = opts.minOz ?? 8;

  let actualOz = 0;
  // start with a small default; grow if any item has larger dims
  let box = { length: 10, width: 6, height: 4 };

  for (const it of items) {
    const qty = Number(it.quantity || 1);

    // preferred: explicit per-item weight in ounces
    let wOz = Number(it.weightOz || 0);

    // optional fallback (if someone sends weight + unit)
    if (!wOz && it.weight != null && it.weightUnit) {
      wOz = toOz(it.weight, it.weightUnit);
    }

    actualOz += (wOz || 0) * qty;

    if (it.lengthIn && it.widthIn && it.heightIn) {
      box.length = Math.max(box.length, Number(it.lengthIn));
      box.width  = Math.max(box.width,  Number(it.widthIn));
      box.height = Math.max(box.height, Number(it.heightIn));
    }
  }

  // dimensional weight (lb) -> oz
  const dimLb = (box.length * box.width * box.height) / DIM_DIVISOR;
  const dimOz = dimLb * OZ_PER_LB;

  // billable = max(actual + packaging, dimensional, minimum)
  const billableOz = Math.max(
    minOz,
    Math.ceil(actualOz + packagingTareOz),
    Math.ceil(dimOz)
  );

  return {
    length: String(box.length),
    width: String(box.width),
    height: String(box.height),
    distanceUnit: "in",
    weight: String(billableOz),
    massUnit: "oz",
  };
}

export async function getCheapestShippoRate({ shippingInfo = {}, items = [] } = {}) {
  const client = assertClient();

  const to = {
    name: shippingInfo?.name || "",
    street1: shippingInfo?.address_line1 || "",
    street2: shippingInfo?.address_line2 || "",
    city: shippingInfo?.city || "",
    state: normalizeState(shippingInfo?.state),
    zip: shippingInfo?.postal_code || "",
    country: (shippingInfo?.country || "US").toUpperCase(),
    email: shippingInfo?.email || shippingInfo?.contact_email || undefined,
    phone: shippingInfo?.phone || shippingInfo?.contact_phone || undefined,
  };

  const from = {
    name: process.env.SHIP_FROM_NAME || process.env.WAREHOUSE_NAME || "Your Biz",
    street1: process.env.SHIP_FROM_STREET1 || process.env.WAREHOUSE_STREET1 || process.env.WAREHOUSE_ADDRESS || "123 Main St",
    city: process.env.SHIP_FROM_CITY || process.env.WAREHOUSE_CITY || "Las Vegas",
    state: process.env.SHIP_FROM_STATE || process.env.WAREHOUSE_STATE || "NV",
    zip: process.env.SHIP_FROM_ZIP || process.env.WAREHOUSE_POSTAL_CODE || "89101",
    country: process.env.SHIP_FROM_COUNTRY || process.env.WAREHOUSE_COUNTRY || "US",
    email: process.env.SHIP_FROM_EMAIL || undefined,
    phone: process.env.SHIP_FROM_PHONE || undefined,
  };

  // ⬇️ NEW: enrich items from DB before building parcel
  const enrichedItems = await hydrateItemsWithDb(items);
  const parcel = buildParcelFromItems(enrichedItems);

  // Ensure minimum weight of 2 lbs (32 oz) for USPS
  const parcelWeightOz = Math.max(
    enrichedItems.reduce((sum, i) => sum + i.weightOz * Number(i.quantity || 1), 0),
    32
  );

  if (process.env.NODE_ENV !== 'production') console.log("📦 rate-debug", {
    items: enrichedItems.map(i => ({
      id: i.id ?? i.productId ?? i.product_id,
      qty: Number(i.quantity || 1),
      weightOz: i.weightOz,
    })),
    parcelWeightOz
  });

  const shipment = await client.shipments.create({
    addressFrom: from,
    addressTo: to,
    parcels: [parcel],
  });

  const handling = Number.isFinite(HANDLING_FEE) ? HANDLING_FEE : 0;
  const rates = (shipment?.rates || [])
    .map((r) => ({
      id: r.objectId,
      provider: r.provider,
      service: r.servicelevel?.name || r.servicelevel?.token,
      amount: Number(r.amount) + handling,
      currency: r.currency,
      eta_days: r.estimatedDays ?? r.eta_days ?? null,
      handling_fee: handling,
    }))
    .filter((r) => Number.isFinite(r.amount));

  if (!rates.length) throw new Error("No shipping rates returned");
  rates.sort((a, b) => a.amount - b.amount);
  return { cheapest: rates[0], rates, shipment };
}
