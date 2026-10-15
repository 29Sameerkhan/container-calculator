import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = process.env.ERPNEXT_BASE_URL;     // e.g. https://erp.slekaind.com
const API_KEY = process.env.ERPNEXT_API_KEY;
const API_SECRET = process.env.ERPNEXT_API_SECRET;

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.json({ error: 'Missing product code' }, { status: 400 });
  }

  if (!BASE_URL || !API_KEY || !API_SECRET) {
    return NextResponse.json({ error: 'ERP credentials not configured' }, { status: 500 });
  }

  try {
    const url = `${BASE_URL}/api/resource/Item/${encodeURIComponent(code)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `token ${API_KEY}:${API_SECRET}`,
      },
      // cache: 'no-store',  // uncomment if you want fresh data every time
    });

    if (res.status === 404) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `ERP returned ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const item = data.data;

    // REPLACE these field names with whatever Yagnik used in ERPNext custom fields:
    const dims = {
      boxLengthMm: item.custom_box_length_mm ?? null,
      boxWidthMm: item.custom_box_width_mm ?? null,
      boxHeightMm: item.custom_box_height_mm ?? null,
      netWeightKg: item.custom_net_weight_kg ?? null,
      grossWeightKg: item.custom_gross_weight_kg ?? null,
      itemName: item.item_name ?? code,
    };

    const missing = Object.entries(dims)
      .filter(([k, v]) => k !== 'itemName' && v === null)
      .map(([k]) => k);

    return NextResponse.json({
      success: true,
      code,
      dims,
      weightManualEntry: missing.some(f => f.includes('Weight')),
      missingFields: missing,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'ERP fetch failed', message }, { status: 500 });
  }
}
