// Starter parts catalog for the Repair vertical.
// Focus: most-repaired parts (screens, batteries, charging ports, back glass) on current flagship devices.
// Users can add their own parts; this is a quick-add starting point to avoid manual seeding.
//
// SKU scheme: <MFR3>-<MODEL>-<PART>
//   MFR3 codes: IPHN (iPhone), IPAD (iPad), MBKA (MacBook Air), MBKP (MacBook Pro),
//               SAMS (Samsung Galaxy phone), SMTB (Samsung Galaxy Tab), SMWT (Galaxy Watch),
//               PIXL (Pixel phone), PIXW (Pixel Watch),
//               ONE (OnePlus), MOTO (Motorola), SONY (Sony Xperia/PlayStation),
//               NTND (Nintendo Switch), VALV (Steam Deck)
//   PART codes: SCRN (screen/display), BATT (battery), CHRG (charging port),
//               BACK (back glass/cover), CAMR (rear camera), CAMF (front camera),
//               SPKR (speaker), BTNS (buttons/home), FRAM (frame/chassis), HING (hinge)
//
// Prices are approximate market values; users should adjust to their margins.

export const PARTS_CATALOG = [
  // ── iPhone 17 series ──
  { sku: 'IPHN-17PM-SCRN', name: 'iPhone 17 Pro Max Screen Assembly', category: 'Screens', unitCost: 180, unitPrice: 420, reorderLevel: 2, supplier: '' },
  { sku: 'IPHN-17PM-BATT', name: 'iPhone 17 Pro Max Battery', category: 'Batteries', unitCost: 35, unitPrice: 110, reorderLevel: 3, supplier: '' },
  { sku: 'IPHN-17PM-CHRG', name: 'iPhone 17 Pro Max Charging Port', category: 'Charging Ports', unitCost: 18, unitPrice: 75, reorderLevel: 2, supplier: '' },
  { sku: 'IPHN-17PM-BACK', name: 'iPhone 17 Pro Max Back Glass', category: 'Back Glass', unitCost: 45, unitPrice: 160, reorderLevel: 2, supplier: '' },

  { sku: 'IPHN-17P-SCRN', name: 'iPhone 17 Pro Screen Assembly', category: 'Screens', unitCost: 155, unitPrice: 380, reorderLevel: 2, supplier: '' },
  { sku: 'IPHN-17P-BATT', name: 'iPhone 17 Pro Battery', category: 'Batteries', unitCost: 32, unitPrice: 100, reorderLevel: 3, supplier: '' },
  { sku: 'IPHN-17P-CHRG', name: 'iPhone 17 Pro Charging Port', category: 'Charging Ports', unitCost: 18, unitPrice: 75, reorderLevel: 2, supplier: '' },

  { sku: 'IPHN-17-SCRN', name: 'iPhone 17 Screen Assembly', category: 'Screens', unitCost: 110, unitPrice: 280, reorderLevel: 2, supplier: '' },
  { sku: 'IPHN-17-BATT', name: 'iPhone 17 Battery', category: 'Batteries', unitCost: 28, unitPrice: 90, reorderLevel: 3, supplier: '' },

  // ── iPhone 16 series ──
  { sku: 'IPHN-16PM-SCRN', name: 'iPhone 16 Pro Max Screen Assembly', category: 'Screens', unitCost: 165, unitPrice: 390, reorderLevel: 2, supplier: '' },
  { sku: 'IPHN-16PM-BATT', name: 'iPhone 16 Pro Max Battery', category: 'Batteries', unitCost: 32, unitPrice: 100, reorderLevel: 3, supplier: '' },
  { sku: 'IPHN-16PM-BACK', name: 'iPhone 16 Pro Max Back Glass', category: 'Back Glass', unitCost: 42, unitPrice: 150, reorderLevel: 2, supplier: '' },

  { sku: 'IPHN-16P-SCRN', name: 'iPhone 16 Pro Screen Assembly', category: 'Screens', unitCost: 140, unitPrice: 350, reorderLevel: 2, supplier: '' },
  { sku: 'IPHN-16P-BATT', name: 'iPhone 16 Pro Battery', category: 'Batteries', unitCost: 30, unitPrice: 95, reorderLevel: 3, supplier: '' },

  { sku: 'IPHN-16-SCRN', name: 'iPhone 16 Screen Assembly', category: 'Screens', unitCost: 100, unitPrice: 260, reorderLevel: 2, supplier: '' },
  { sku: 'IPHN-16-BATT', name: 'iPhone 16 Battery', category: 'Batteries', unitCost: 26, unitPrice: 85, reorderLevel: 3, supplier: '' },

  // ── iPhone 15 series ──
  { sku: 'IPHN-15PM-SCRN', name: 'iPhone 15 Pro Max Screen Assembly', category: 'Screens', unitCost: 140, unitPrice: 340, reorderLevel: 2, supplier: '' },
  { sku: 'IPHN-15PM-BATT', name: 'iPhone 15 Pro Max Battery', category: 'Batteries', unitCost: 28, unitPrice: 90, reorderLevel: 3, supplier: '' },
  { sku: 'IPHN-15PM-CHRG', name: 'iPhone 15 Pro Max Charging Port (USB-C)', category: 'Charging Ports', unitCost: 15, unitPrice: 65, reorderLevel: 2, supplier: '' },

  { sku: 'IPHN-15P-SCRN', name: 'iPhone 15 Pro Screen Assembly', category: 'Screens', unitCost: 120, unitPrice: 300, reorderLevel: 2, supplier: '' },
  { sku: 'IPHN-15P-BATT', name: 'iPhone 15 Pro Battery', category: 'Batteries', unitCost: 26, unitPrice: 85, reorderLevel: 3, supplier: '' },

  { sku: 'IPHN-15-SCRN', name: 'iPhone 15 Screen Assembly', category: 'Screens', unitCost: 85, unitPrice: 220, reorderLevel: 3, supplier: '' },
  { sku: 'IPHN-15-BATT', name: 'iPhone 15 Battery', category: 'Batteries', unitCost: 22, unitPrice: 75, reorderLevel: 3, supplier: '' },

  // ── iPhone 14 / 13 ──
  { sku: 'IPHN-14PM-SCRN', name: 'iPhone 14 Pro Max Screen Assembly', category: 'Screens', unitCost: 110, unitPrice: 290, reorderLevel: 2, supplier: '' },
  { sku: 'IPHN-14PM-BATT', name: 'iPhone 14 Pro Max Battery', category: 'Batteries', unitCost: 24, unitPrice: 80, reorderLevel: 3, supplier: '' },
  { sku: 'IPHN-14-SCRN', name: 'iPhone 14 Screen Assembly', category: 'Screens', unitCost: 70, unitPrice: 190, reorderLevel: 3, supplier: '' },
  { sku: 'IPHN-14-BATT', name: 'iPhone 14 Battery', category: 'Batteries', unitCost: 20, unitPrice: 70, reorderLevel: 3, supplier: '' },

  { sku: 'IPHN-13-SCRN', name: 'iPhone 13 Screen Assembly', category: 'Screens', unitCost: 60, unitPrice: 170, reorderLevel: 3, supplier: '' },
  { sku: 'IPHN-13-BATT', name: 'iPhone 13 Battery', category: 'Batteries', unitCost: 18, unitPrice: 65, reorderLevel: 3, supplier: '' },
  { sku: 'IPHN-13-CHRG', name: 'iPhone 13 Charging Port (Lightning)', category: 'Charging Ports', unitCost: 10, unitPrice: 50, reorderLevel: 2, supplier: '' },

  // ── Samsung Galaxy S flagships ──
  { sku: 'SAMS-S25U-SCRN', name: 'Galaxy S25 Ultra Screen Assembly', category: 'Screens', unitCost: 175, unitPrice: 400, reorderLevel: 2, supplier: '' },
  { sku: 'SAMS-S25U-BATT', name: 'Galaxy S25 Ultra Battery', category: 'Batteries', unitCost: 30, unitPrice: 95, reorderLevel: 3, supplier: '' },
  { sku: 'SAMS-S25U-BACK', name: 'Galaxy S25 Ultra Back Glass', category: 'Back Glass', unitCost: 40, unitPrice: 140, reorderLevel: 2, supplier: '' },

  { sku: 'SAMS-S25-SCRN', name: 'Galaxy S25 Screen Assembly', category: 'Screens', unitCost: 120, unitPrice: 300, reorderLevel: 2, supplier: '' },
  { sku: 'SAMS-S25-BATT', name: 'Galaxy S25 Battery', category: 'Batteries', unitCost: 25, unitPrice: 80, reorderLevel: 3, supplier: '' },

  { sku: 'SAMS-S24U-SCRN', name: 'Galaxy S24 Ultra Screen Assembly', category: 'Screens', unitCost: 155, unitPrice: 360, reorderLevel: 2, supplier: '' },
  { sku: 'SAMS-S24U-BATT', name: 'Galaxy S24 Ultra Battery', category: 'Batteries', unitCost: 28, unitPrice: 90, reorderLevel: 3, supplier: '' },
  { sku: 'SAMS-S24U-BACK', name: 'Galaxy S24 Ultra Back Glass', category: 'Back Glass', unitCost: 35, unitPrice: 130, reorderLevel: 2, supplier: '' },

  { sku: 'SAMS-S24-SCRN', name: 'Galaxy S24 Screen Assembly', category: 'Screens', unitCost: 110, unitPrice: 275, reorderLevel: 2, supplier: '' },
  { sku: 'SAMS-S24-BATT', name: 'Galaxy S24 Battery', category: 'Batteries', unitCost: 24, unitPrice: 78, reorderLevel: 3, supplier: '' },

  { sku: 'SAMS-S23U-SCRN', name: 'Galaxy S23 Ultra Screen Assembly', category: 'Screens', unitCost: 130, unitPrice: 310, reorderLevel: 2, supplier: '' },
  { sku: 'SAMS-S23-SCRN', name: 'Galaxy S23 Screen Assembly', category: 'Screens', unitCost: 90, unitPrice: 230, reorderLevel: 2, supplier: '' },

  // ── Samsung Z Fold/Flip ──
  { sku: 'SAMS-ZF6-SCRN', name: 'Galaxy Z Fold 6 Inner Screen', category: 'Screens', unitCost: 320, unitPrice: 700, reorderLevel: 1, supplier: '' },
  { sku: 'SAMS-ZF6-HING', name: 'Galaxy Z Fold 6 Hinge Assembly', category: 'Hinges', unitCost: 85, unitPrice: 230, reorderLevel: 1, supplier: '' },
  { sku: 'SAMS-ZFP6-SCRN', name: 'Galaxy Z Flip 6 Inner Screen', category: 'Screens', unitCost: 210, unitPrice: 480, reorderLevel: 1, supplier: '' },
  { sku: 'SAMS-ZFP6-HING', name: 'Galaxy Z Flip 6 Hinge Assembly', category: 'Hinges', unitCost: 65, unitPrice: 180, reorderLevel: 1, supplier: '' },

  // ── Google Pixel ──
  { sku: 'PIXL-9PXL-SCRN', name: 'Pixel 9 Pro XL Screen Assembly', category: 'Screens', unitCost: 135, unitPrice: 320, reorderLevel: 2, supplier: '' },
  { sku: 'PIXL-9PXL-BATT', name: 'Pixel 9 Pro XL Battery', category: 'Batteries', unitCost: 26, unitPrice: 85, reorderLevel: 2, supplier: '' },
  { sku: 'PIXL-9P-SCRN', name: 'Pixel 9 Pro Screen Assembly', category: 'Screens', unitCost: 115, unitPrice: 280, reorderLevel: 2, supplier: '' },
  { sku: 'PIXL-9-SCRN', name: 'Pixel 9 Screen Assembly', category: 'Screens', unitCost: 95, unitPrice: 240, reorderLevel: 2, supplier: '' },
  { sku: 'PIXL-8P-SCRN', name: 'Pixel 8 Pro Screen Assembly', category: 'Screens', unitCost: 105, unitPrice: 260, reorderLevel: 2, supplier: '' },
  { sku: 'PIXL-8-SCRN', name: 'Pixel 8 Screen Assembly', category: 'Screens', unitCost: 85, unitPrice: 220, reorderLevel: 2, supplier: '' },

  // ── OnePlus ──
  { sku: 'ONE-13-SCRN', name: 'OnePlus 13 Screen Assembly', category: 'Screens', unitCost: 120, unitPrice: 290, reorderLevel: 1, supplier: '' },
  { sku: 'ONE-12-SCRN', name: 'OnePlus 12 Screen Assembly', category: 'Screens', unitCost: 110, unitPrice: 270, reorderLevel: 1, supplier: '' },

  // ── iPad ──
  { sku: 'IPAD-PRO13-M4-SCRN', name: 'iPad Pro 13" (M4) Screen Assembly', category: 'Screens', unitCost: 280, unitPrice: 580, reorderLevel: 1, supplier: '' },
  { sku: 'IPAD-PRO11-M4-SCRN', name: 'iPad Pro 11" (M4) Screen Assembly', category: 'Screens', unitCost: 230, unitPrice: 490, reorderLevel: 1, supplier: '' },
  { sku: 'IPAD-AIR13-M2-SCRN', name: 'iPad Air 13" (M2) Screen Assembly', category: 'Screens', unitCost: 195, unitPrice: 420, reorderLevel: 1, supplier: '' },
  { sku: 'IPAD-11-10G-SCRN', name: 'iPad (10th gen) Screen Assembly', category: 'Screens', unitCost: 95, unitPrice: 240, reorderLevel: 2, supplier: '' },
  { sku: 'IPAD-MINI7-SCRN', name: 'iPad Mini (7th gen) Screen Assembly', category: 'Screens', unitCost: 110, unitPrice: 270, reorderLevel: 1, supplier: '' },

  // ── MacBook ──
  { sku: 'MBKA-13-M4-SCRN', name: 'MacBook Air 13" (M4) Display Assembly', category: 'Screens', unitCost: 420, unitPrice: 790, reorderLevel: 1, supplier: '' },
  { sku: 'MBKA-13-M4-BATT', name: 'MacBook Air 13" (M4) Battery', category: 'Batteries', unitCost: 75, unitPrice: 180, reorderLevel: 2, supplier: '' },
  { sku: 'MBKA-15-M4-SCRN', name: 'MacBook Air 15" (M4) Display Assembly', category: 'Screens', unitCost: 490, unitPrice: 890, reorderLevel: 1, supplier: '' },
  { sku: 'MBKA-15-M4-BATT', name: 'MacBook Air 15" (M4) Battery', category: 'Batteries', unitCost: 85, unitPrice: 210, reorderLevel: 2, supplier: '' },
  { sku: 'MBKP-14-M4-SCRN', name: 'MacBook Pro 14" (M4) Display Assembly', category: 'Screens', unitCost: 560, unitPrice: 990, reorderLevel: 1, supplier: '' },
  { sku: 'MBKP-16-M4-SCRN', name: 'MacBook Pro 16" (M4) Display Assembly', category: 'Screens', unitCost: 680, unitPrice: 1190, reorderLevel: 1, supplier: '' },

  // ── Apple Watch ──
  { sku: 'APL-WS10-46-SCRN', name: 'Apple Watch Series 10 (46mm) Screen', category: 'Screens', unitCost: 95, unitPrice: 250, reorderLevel: 2, supplier: '' },
  { sku: 'APL-WS10-42-SCRN', name: 'Apple Watch Series 10 (42mm) Screen', category: 'Screens', unitCost: 85, unitPrice: 225, reorderLevel: 2, supplier: '' },
  { sku: 'APL-WU2-SCRN', name: 'Apple Watch Ultra 2 Screen', category: 'Screens', unitCost: 115, unitPrice: 290, reorderLevel: 1, supplier: '' },
  { sku: 'APL-WS10-BATT', name: 'Apple Watch Series 10 Battery', category: 'Batteries', unitCost: 22, unitPrice: 70, reorderLevel: 2, supplier: '' },

  // ── Game Consoles ──
  { sku: 'NTND-SW2-SCRN', name: 'Nintendo Switch 2 Screen', category: 'Screens', unitCost: 95, unitPrice: 230, reorderLevel: 1, supplier: '' },
  { sku: 'NTND-SWO-SCRN', name: 'Nintendo Switch OLED Screen', category: 'Screens', unitCost: 75, unitPrice: 190, reorderLevel: 2, supplier: '' },
  { sku: 'NTND-SWO-JOYL', name: 'Nintendo Switch Joy-Con (Left)', category: 'Controllers', unitCost: 25, unitPrice: 65, reorderLevel: 3, supplier: '' },
  { sku: 'NTND-SWO-JOYR', name: 'Nintendo Switch Joy-Con (Right)', category: 'Controllers', unitCost: 25, unitPrice: 65, reorderLevel: 3, supplier: '' },
  { sku: 'VALV-DECK-SCRN', name: 'Steam Deck OLED Screen', category: 'Screens', unitCost: 130, unitPrice: 310, reorderLevel: 1, supplier: '' },
  { sku: 'SONY-PS5P-HDMI', name: 'PS5 Pro HDMI Port', category: 'Ports', unitCost: 8, unitPrice: 50, reorderLevel: 3, supplier: '' },
  { sku: 'SONY-PS5-HDMI', name: 'PS5 HDMI Port', category: 'Ports', unitCost: 8, unitPrice: 50, reorderLevel: 3, supplier: '' },

  // ── AirPods / Buds ──
  { sku: 'APL-APP2-BATT', name: 'AirPods Pro 2 Battery (Case)', category: 'Batteries', unitCost: 20, unitPrice: 60, reorderLevel: 2, supplier: '' },
];

// Group parts by category for easier browsing
export function getPartsByCategory() {
  const grouped = {};
  PARTS_CATALOG.forEach(part => {
    const cat = part.category || 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(part);
  });
  return grouped;
}
