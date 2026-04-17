// Device catalog for Repair vertical — Manufacturer → Product Line → Model.
// Focus: current and recent (last ~3 generations) of commonly-repaired consumer electronics.
// "Other" is implicit at every level in the picker component and triggers a free-text field.

export const DEVICE_CATALOG = {
  'Apple': {
    'iPhone': [
      'iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone 17 Air', 'iPhone 17',
      'iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16 Plus', 'iPhone 16', 'iPhone 16e',
      'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15 Plus', 'iPhone 15',
      'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14 Plus', 'iPhone 14',
      'iPhone 13 Pro Max', 'iPhone 13 Pro', 'iPhone 13', 'iPhone 13 Mini',
      'iPhone 12 Pro Max', 'iPhone 12 Pro', 'iPhone 12', 'iPhone 12 Mini',
      'iPhone SE (3rd gen)', 'iPhone SE (2nd gen)',
    ],
    'iPad': [
      'iPad Pro 13" (M4)', 'iPad Pro 11" (M4)',
      'iPad Air 13" (M2)', 'iPad Air 11" (M2)',
      'iPad (11th gen)', 'iPad (10th gen)',
      'iPad Mini (7th gen)', 'iPad Mini (6th gen)',
    ],
    'MacBook': [
      'MacBook Pro 16" (M4 Max)', 'MacBook Pro 16" (M4 Pro)',
      'MacBook Pro 14" (M4 Max)', 'MacBook Pro 14" (M4 Pro)', 'MacBook Pro 14" (M4)',
      'MacBook Air 15" (M4)', 'MacBook Air 13" (M4)',
      'MacBook Air 15" (M3)', 'MacBook Air 13" (M3)',
      'MacBook Pro 16" (M3 Max)', 'MacBook Pro 14" (M3)',
      'MacBook Air 13" (M2)', 'MacBook Pro 13" (M2)',
    ],
    'Mac Desktop': [
      'Mac Studio (M4 Max)', 'Mac Studio (M4 Ultra)',
      'Mac Mini (M4 Pro)', 'Mac Mini (M4)',
      'iMac 24" (M4)', 'iMac 24" (M3)',
      'Mac Pro (M2 Ultra)',
    ],
    'Apple Watch': [
      'Apple Watch Series 10 (46mm)', 'Apple Watch Series 10 (42mm)',
      'Apple Watch Ultra 2', 'Apple Watch SE (2nd gen)',
      'Apple Watch Series 9 (45mm)', 'Apple Watch Series 9 (41mm)',
      'Apple Watch Series 8', 'Apple Watch Series 7',
    ],
    'AirPods': [
      'AirPods 4 (ANC)', 'AirPods 4',
      'AirPods Pro 2 (USB-C)', 'AirPods Pro 2',
      'AirPods Max (USB-C)', 'AirPods Max',
      'AirPods 3',
    ],
  },

  'Samsung': {
    'Galaxy S': [
      'Galaxy S25 Ultra', 'Galaxy S25+', 'Galaxy S25',
      'Galaxy S24 Ultra', 'Galaxy S24+', 'Galaxy S24', 'Galaxy S24 FE',
      'Galaxy S23 Ultra', 'Galaxy S23+', 'Galaxy S23', 'Galaxy S23 FE',
      'Galaxy S22 Ultra', 'Galaxy S22+', 'Galaxy S22',
    ],
    'Galaxy Z (Fold/Flip)': [
      'Galaxy Z Fold 6', 'Galaxy Z Flip 6',
      'Galaxy Z Fold 5', 'Galaxy Z Flip 5',
      'Galaxy Z Fold 4', 'Galaxy Z Flip 4',
    ],
    'Galaxy A': [
      'Galaxy A55 5G', 'Galaxy A35 5G', 'Galaxy A25 5G', 'Galaxy A15 5G',
      'Galaxy A54 5G', 'Galaxy A34 5G',
    ],
    'Galaxy Tab': [
      'Galaxy Tab S10 Ultra', 'Galaxy Tab S10+',
      'Galaxy Tab S9 Ultra', 'Galaxy Tab S9+', 'Galaxy Tab S9', 'Galaxy Tab S9 FE',
      'Galaxy Tab A9+', 'Galaxy Tab A9',
    ],
    'Galaxy Watch': [
      'Galaxy Watch Ultra', 'Galaxy Watch 7 (44mm)', 'Galaxy Watch 7 (40mm)',
      'Galaxy Watch 6 Classic', 'Galaxy Watch 6',
    ],
    'Galaxy Buds': [
      'Galaxy Buds 3 Pro', 'Galaxy Buds 3',
      'Galaxy Buds 2 Pro', 'Galaxy Buds FE',
    ],
  },

  'Google': {
    'Pixel': [
      'Pixel 9 Pro XL', 'Pixel 9 Pro', 'Pixel 9', 'Pixel 9 Pro Fold', 'Pixel 9a',
      'Pixel 8 Pro', 'Pixel 8', 'Pixel 8a',
      'Pixel 7 Pro', 'Pixel 7', 'Pixel 7a',
      'Pixel Fold',
    ],
    'Pixel Tablet': [
      'Pixel Tablet',
    ],
    'Pixel Watch': [
      'Pixel Watch 3 (45mm)', 'Pixel Watch 3 (41mm)',
      'Pixel Watch 2', 'Pixel Watch',
    ],
    'Pixel Buds': [
      'Pixel Buds Pro 2', 'Pixel Buds Pro', 'Pixel Buds A-Series',
    ],
  },

  'OnePlus': {
    'Flagship': ['OnePlus 13', 'OnePlus 12', 'OnePlus 11', 'OnePlus Open'],
    'Nord': ['OnePlus Nord 4', 'OnePlus Nord CE 4', 'OnePlus Nord N30'],
  },

  'Motorola': {
    'Edge': ['Edge 50 Ultra', 'Edge 50 Pro', 'Edge 50', 'Edge (2024)', 'Edge+ (2023)'],
    'Razr': ['Razr 50 Ultra', 'Razr 50', 'Razr 40 Ultra', 'Razr 40'],
    'G Series': ['Moto G Power (2024)', 'Moto G Stylus 5G (2024)', 'Moto G 5G (2024)'],
  },

  'Sony': {
    'Xperia': ['Xperia 1 VI', 'Xperia 5 V', 'Xperia 10 VI'],
    'PlayStation': ['PlayStation 5 Pro', 'PlayStation 5 Slim', 'PlayStation 5', 'PlayStation Portal', 'PlayStation 4 Pro'],
    'Headphones': ['WH-1000XM5', 'WH-1000XM4', 'WF-1000XM5', 'WF-1000XM4'],
  },

  'Microsoft': {
    'Surface': [
      'Surface Pro 11 (2024)', 'Surface Laptop 7 (2024)',
      'Surface Pro 10', 'Surface Laptop 6',
      'Surface Pro 9', 'Surface Laptop 5',
      'Surface Go 4', 'Surface Studio 2+',
    ],
    'Xbox': ['Xbox Series X', 'Xbox Series S'],
  },

  'Dell': {
    'XPS': ['XPS 16 (9650)', 'XPS 14 (9450)', 'XPS 13 (9350)', 'XPS 13 Plus (9320)'],
    'Inspiron': ['Inspiron 16 Plus (7640)', 'Inspiron 14 Plus (7440)', 'Inspiron 15 (3535)'],
    'Alienware': ['Alienware m18 R2', 'Alienware m16 R2', 'Alienware x16 R2', 'Alienware x14 R2'],
    'Latitude': ['Latitude 7450', 'Latitude 5450', 'Latitude 9450 2-in-1'],
    'Precision': ['Precision 5690', 'Precision 7780'],
  },

  'HP': {
    'Spectre': ['Spectre x360 16 (2024)', 'Spectre x360 14 (2024)'],
    'Pavilion': ['Pavilion Plus 14 (2024)', 'Pavilion Plus 16 (2024)'],
    'Omen': ['OMEN Transcend 14', 'OMEN 17', 'OMEN Transcend 16'],
    'Envy': ['Envy x360 14 (2024)', 'Envy 16 (2024)'],
    'EliteBook': ['EliteBook 840 G11', 'EliteBook 1040 G11'],
  },

  'Lenovo': {
    'ThinkPad': ['ThinkPad X1 Carbon Gen 13', 'ThinkPad T14 Gen 5', 'ThinkPad P16 Gen 2', 'ThinkPad X1 Yoga Gen 9'],
    'Legion': ['Legion Pro 7i Gen 9', 'Legion 5i Gen 9', 'Legion Go', 'Legion 9i Gen 9'],
    'Yoga': ['Yoga 9i Gen 10', 'Yoga 7i 2-in-1 Gen 9', 'Yoga Slim 7x'],
    'IdeaPad': ['IdeaPad Slim 5 (2024)', 'IdeaPad Pro 5 (2024)'],
  },

  'ASUS': {
    'ROG': ['ROG Strix Scar 18', 'ROG Zephyrus G16 (2024)', 'ROG Zephyrus G14 (2024)', 'ROG Ally X', 'ROG Ally'],
    'ZenBook': ['ZenBook Duo (2024)', 'ZenBook S 16 OLED', 'ZenBook 14 OLED'],
    'VivoBook': ['VivoBook S 16 OLED', 'VivoBook Pro 15 OLED'],
    'TUF': ['TUF Gaming A16', 'TUF Gaming F15'],
  },

  'MSI': {
    'Gaming': ['Titan 18 HX', 'Raider 18 HX', 'Stealth 16 AI Studio', 'Cyborg 15', 'Katana 15'],
    'Creator': ['Creator Z17 HX Studio', 'Prestige 16 AI Evo'],
  },

  'Razer': {
    'Blade': ['Blade 18 (2024)', 'Blade 16 (2024)', 'Blade 14 (2024)'],
  },

  'Acer': {
    'Swift': ['Swift Go 14 AI', 'Swift X 14', 'Swift 14 AI'],
    'Predator': ['Predator Helios Neo 16', 'Predator Helios 18', 'Predator Triton 14'],
    'Nitro': ['Nitro V 16', 'Nitro 17'],
    'Aspire': ['Aspire Vero 16', 'Aspire 5 (2024)'],
  },

  'Framework': {
    'Laptop': ['Framework Laptop 13 (AMD Ryzen AI 300)', 'Framework Laptop 13 (Intel Core Ultra)', 'Framework Laptop 16'],
  },

  'Nintendo': {
    'Switch': ['Nintendo Switch 2', 'Nintendo Switch OLED', 'Nintendo Switch', 'Nintendo Switch Lite'],
  },

  'Valve': {
    'Steam Deck': ['Steam Deck OLED', 'Steam Deck LCD'],
  },

  'Nothing': {
    'Phone': ['Nothing Phone (2a) Plus', 'Nothing Phone (2a)', 'Nothing Phone (2)', 'Nothing Phone (1)'],
    'Ear': ['Nothing Ear (open)', 'Nothing Ear', 'Nothing Ear (a)'],
  },

  'Xiaomi': {
    'Mi / Xiaomi': ['Xiaomi 14 Ultra', 'Xiaomi 14', 'Xiaomi 13T Pro'],
    'Redmi': ['Redmi Note 13 Pro+', 'Redmi Note 13 Pro'],
    'POCO': ['POCO X6 Pro', 'POCO F6 Pro'],
  },

  'Garmin': {
    'Smartwatch': ['fēnix 8', 'epix Pro', 'Forerunner 965', 'Venu 3', 'Instinct 2X Solar'],
  },

  'Fitbit': {
    'Smartwatch / Tracker': ['Versa 4', 'Sense 2', 'Charge 6', 'Inspire 3'],
  },

  'Bose': {
    'Headphones / Earbuds': ['QuietComfort Ultra Headphones', 'QuietComfort Ultra Earbuds', 'QuietComfort 45', 'Sport Earbuds'],
  },

  'Amazon': {
    'Fire Tablet': ['Fire HD 10 (2023)', 'Fire Max 11', 'Fire HD 8 (2022)'],
    'Kindle': ['Kindle Colorsoft', 'Kindle Scribe', 'Kindle Paperwhite (12th gen)', 'Kindle (11th gen)'],
  },
};

// Flatten helpers — convenient for search / default lookups.
export function getManufacturers() {
  return Object.keys(DEVICE_CATALOG);
}

export function getProductLines(manufacturer) {
  if (!manufacturer || !DEVICE_CATALOG[manufacturer]) return [];
  return Object.keys(DEVICE_CATALOG[manufacturer]);
}

export function getModels(manufacturer, productLine) {
  if (!manufacturer || !productLine) return [];
  const mfr = DEVICE_CATALOG[manufacturer];
  if (!mfr) return [];
  return mfr[productLine] || [];
}
