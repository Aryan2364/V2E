const crypto = require('crypto');
const p = require('./_db');
const uid = () => crypto.randomUUID();

const ORG = 'b2b49543-ebd7-4399-828f-2a4564a2084e'; // Shree Apex Industries Pvt. Ltd.
const OWNER = '46479585-ffde-4ddb-9373-1c3c43655b09'; // Mehul Shah (admin)
const MAP_NAME = 'Sales — Airport';

// ---- helpers to accumulate rows -------------------------------------------
const nodes = [];
const conns = [];
let mapId;

function node({ id = uid(), parent = null, kind = 'task', name, desc = null, x = 0, y = 0, order = 0, status = 'final' }) {
  nodes.push({
    id, organization_id: ORG, map_id: mapId, parent_node_id: parent, kind,
    name, description: desc, status, position_x: x, position_y: y, sort_order: order,
    created_by_user_id: OWNER,
  });
  return id;
}
function edge(source, target, cond, parent) {
  conns.push({
    id: uid(), organization_id: ORG, map_id: mapId, parent_node_id: parent,
    source_node_id: source, target_node_id: target, label: null, condition_kind: cond || 'none',
  });
}

(async () => {
  // wipe any prior copy of this test map so re-runs stay clean
  const existing = await p.processMap.findMany({ where: { organization_id: ORG, name: MAP_NAME }, select: { id: true } });
  for (const m of existing) {
    await p.processConnection.deleteMany({ where: { map_id: m.id } });
    await p.processNode.deleteMany({ where: { map_id: m.id } });
    await p.processMap.delete({ where: { id: m.id } });
  }
  if (existing.length) console.log('Removed ' + existing.length + ' prior "' + MAP_NAME + '" map(s).');

  mapId = uid();

  // ---- TOP LEVEL: four containers ------------------------------------------
  const c1 = node({ kind: 'container', name: '01 · Order to packed cartons', x: 300, y: 40, order: 0,
    desc: 'Common to all three airports. Jodhpur follows this too, up to the point where cartons stop being needed (see 03).' });
  const c2 = node({ kind: 'container', name: '02 · Dispatch — Jaipur & Udaipur', x: 300, y: 180, order: 1,
    desc: 'The paperwork that travels with the boxes and the software entry happen side by side before the boxes move.' });
  const c3 = node({ kind: 'container', name: '03 · Jodhpur — what changes', x: 300, y: 320, order: 2,
    desc: 'Same city as shop & factory — no transporter, no bus. 01 up to packing still applies.' });
  const c4 = node({ kind: 'container', name: '04 · Return of sweets', x: 300, y: 460, order: 3,
    desc: 'What the outlet does to send stock back. The receiving end is not yet mapped.' });

  const X = 270, XE = 333, XD = 307; // task / event / decision x

  // ===== 01 · Order to packed cartons =====
  let o = 0;
  const s1  = node({ parent: c1, kind: 'start_event', name: 'Order received in the WhatsApp group', x: XE, y: 0, order: o++ });
  const n1a = node({ parent: c1, name: "Compile every outlet's order into one order sheet", x: X, y: 90, order: o++ });
  const n1b = node({ parent: c1, name: 'Procure the items — three ways', x: X, y: 200, order: o++,
    desc: 'IN STOCK: items already in finished goods.  •  SEMI-FINISHED: ghewar, balushai, mava kachori — finished and sent to the FG store, which is informed.  •  PRODUCTION: a big order goes on an order form; a small one is told to them directly.' });
  const d1  = node({ parent: c1, kind: 'decision', name: 'Everything available?', x: XD, y: 310, order: o++ });
  const n1c = node({ parent: c1, name: 'Tell the group what is short and send only the quantity that is available', x: 560, y: 315, order: o++ });
  const n1d = node({ parent: c1, name: 'Put the sweets into boxes — namkeen comes already packed', x: X, y: 450, order: o++ });
  const n1e = node({ parent: c1, name: 'Serialing: mark each box with the date the airport receives it, not the date it was packed', x: X, y: 560, order: o++ });
  const n1f = node({ parent: c1, name: 'Seal-pack the sweet boxes', x: X, y: 670, order: o++ });
  const n1g = node({ parent: c1, name: 'Print stickers and paste them on the items', x: X, y: 780, order: o++ });
  const n1h = node({ parent: c1, name: 'Make the challan — one for each outlet, not one per trip', x: X, y: 890, order: o++,
    desc: "JU's challan comes straight out of the software. J1 and U1 are entered by hand in the other software." });
  const n1i = node({ parent: c1, name: 'Place outlet-wise in cartons and bags; redistribute so no single box gets too heavy', x: X, y: 1000, order: o++ });
  const n1j = node({ parent: c1, name: 'Seal the cartons and label the boxes', x: X, y: 1110, order: o++ });
  const e1  = node({ parent: c1, kind: 'end_event', name: 'Ready for dispatch', x: XE, y: 1220, order: o++ });
  edge(s1, n1a, 'none', c1); edge(n1a, n1b, 'none', c1); edge(n1b, d1, 'none', c1);
  edge(d1, n1d, 'yes', c1); edge(d1, n1c, 'no', c1); edge(n1c, n1d, 'none', c1);
  edge(n1d, n1e, 'none', c1); edge(n1e, n1f, 'none', c1); edge(n1f, n1g, 'none', c1);
  edge(n1g, n1h, 'none', c1); edge(n1h, n1i, 'none', c1); edge(n1i, n1j, 'none', c1); edge(n1j, e1, 'none', c1);

  // ===== 02 · Dispatch — Jaipur & Udaipur =====
  o = 0;
  const s2  = node({ parent: c2, kind: 'start_event', name: 'Boxes ready for dispatch', x: XE, y: 0, order: o++ });
  const n2a = node({ parent: c2, name: 'Create the gate pass and a dummy bill from the counter shop', x: 120, y: 110, order: o++ });
  const n2b = node({ parent: c2, name: 'Enter the data in the software and prepare the bill', x: 420, y: 110, order: o++ });
  const n2c = node({ parent: c2, name: 'Guard checks the challan', x: X, y: 250, order: o++ });
  const n2d = node({ parent: c2, name: 'Load the boxes into the tempo', x: X, y: 360, order: o++ });
  const n2e = node({ parent: c2, name: 'Deliver to the bus stand', x: X, y: 470, order: o++ });
  const n2f = node({ parent: c2, name: "Make the payment; take the bill and the transporter's sticker", x: X, y: 580, order: o++ });
  const n2g = node({ parent: c2, name: 'Put the sticker on the boxes, outlet-wise', x: X, y: 690, order: o++ });
  const n2h = node({ parent: c2, name: 'Share the bilty in the group and send the bill to petty cash', x: X, y: 800, order: o++ });
  const e2  = node({ parent: c2, kind: 'end_event', name: 'Goods on the way', x: XE, y: 910, order: o++ });
  const q2  = node({ parent: c2, name: '❓ Open — confirm with client: who collects at Jaipur & Udaipur, and does anything come back to confirm arrival (signed challan / group message / nothing)?', x: X, y: 1020, order: o++, status: 'draft' });
  edge(s2, n2a, 'none', c2); edge(s2, n2b, 'none', c2);
  edge(n2a, n2c, 'none', c2); edge(n2b, n2c, 'none', c2);
  edge(n2c, n2d, 'none', c2); edge(n2d, n2e, 'none', c2); edge(n2e, n2f, 'none', c2);
  edge(n2f, n2g, 'none', c2); edge(n2g, n2h, 'none', c2); edge(n2h, e2, 'none', c2); edge(e2, q2, 'none', c2);

  // ===== 03 · Jodhpur — what changes =====
  o = 0;
  const s3  = node({ parent: c3, kind: 'start_event', name: 'Order received for Jodhpur (JU)', x: XE, y: 0, order: o++ });
  const n3a = node({ parent: c3, name: 'The software entry is made as soon as the order comes in', x: X, y: 110, order: o++,
    desc: 'For the other airports this entry is made later, at dispatch.' });
  const n3b = node({ parent: c3, name: 'Items are accumulated and packed the same way as for the other airports', x: X, y: 220, order: o++,
    desc: 'Cartons and carton-wise placing are not needed — basic packing only.' });
  const n3c = node({ parent: c3, name: 'Make the challan and sticker', x: X, y: 330, order: o++ });
  const n3d = node({ parent: c3, name: 'Deliver straight to the airport on a two- or four-wheeler', x: X, y: 440, order: o++ });
  const e3  = node({ parent: c3, kind: 'end_event', name: 'Delivered', x: XE, y: 550, order: o++ });
  const q3  = node({ parent: c3, name: '❓ Open — confirm with client: boxes still leave the premises. Is a gate pass made and checked by the guard, or skipped because delivery is local?', x: X, y: 660, order: o++, status: 'draft' });
  edge(s3, n3a, 'none', c3); edge(n3a, n3b, 'none', c3); edge(n3b, n3c, 'none', c3);
  edge(n3c, n3d, 'none', c3); edge(n3d, e3, 'none', c3); edge(e3, q3, 'none', c3);

  // ===== 04 · Return of sweets =====
  o = 0;
  const s4  = node({ parent: c4, kind: 'start_event', name: 'Return started within the return period', x: XE, y: 0, order: o++ });
  const n4a = node({ parent: c4, name: 'Make the challan', x: X, y: 110, order: o++ });
  const n4b = node({ parent: c4, name: 'Pack the boxes', x: X, y: 220, order: o++ });
  const n4c = node({ parent: c4, name: 'Get the bilty and share it in the group', x: X, y: 330, order: o++ });
  const e4  = node({ parent: c4, kind: 'end_event', name: 'Goods sent back', x: XE, y: 440, order: o++ });
  const q4a = node({ parent: c4, name: '❓ Open — confirm with client: who starts the return (outlet, via the group)? How many days is the return period, and who makes the challan? Same for Jodhpur, with no bus, no bilty?', x: 120, y: 560, order: o++, status: 'draft' });
  const q4b = node({ parent: c4, name: '❓ Open — receiving end not mapped: when boxes reach the factory, who takes them in? Checked against the challan? Back into FG stock or written off? Any credit note, given the real value never came in on the dummy bill?', x: 470, y: 560, order: o++, status: 'draft' });
  edge(s4, n4a, 'none', c4); edge(n4a, n4b, 'none', c4); edge(n4b, n4c, 'none', c4);
  edge(n4c, e4, 'none', c4); edge(e4, q4a, 'none', c4); edge(e4, q4b, 'none', c4);

  // ---- write everything ----------------------------------------------------
  await p.processMap.create({ data: {
    id: mapId, organization_id: ORG, name: MAP_NAME, created_by_user_id: OWNER,
    description: 'Sweets & Namkeen · Sales. From the order landing in the WhatsApp group to the boxes reaching the outlet, and back again when sweets are returned. Outlet codes JU (Jodhpur) · J1 (Jaipur) · U1 (Udaipur) are the spine.',
  }});
  await p.processNode.createMany({ data: nodes });
  await p.processConnection.createMany({ data: conns });

  console.log('Created map ' + mapId);
  console.log('  nodes: ' + nodes.length + '  (4 containers + flows)');
  console.log('  connections: ' + conns.length);
  await p.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
