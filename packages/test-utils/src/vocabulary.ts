import type { DeviceType } from "@pulsedesk/contracts";

/** Pages of the fictional SaaS product whose visitors PulseDesk monitors. */
export const SITE_PAGES = {
  "/": "Home",
  "/features": "Features",
  "/integrations": "Integrations",
  "/pricing": "Pricing",
  "/pricing/enterprise": "Enterprise plan",
  "/customers": "Customer stories",
  "/docs/getting-started": "Getting started",
  "/blog/realtime-dashboards": "Building realtime dashboards",
  "/contact-sales": "Contact sales",
  "/signup": "Create your account",
  "/checkout": "Checkout",
} as const satisfies Record<string, string>;

export type SitePath = keyof typeof SITE_PAGES;
export const SITE_PATHS = Object.keys(SITE_PAGES) as SitePath[];

export const LANDING_PATHS: readonly SitePath[] = [
  "/",
  "/",
  "/pricing",
  "/features",
  "/blog/realtime-dashboards",
  "/docs/getting-started",
];

export const FIRST_NAMES = [
  "Sofia",
  "Mateo",
  "Amara",
  "Kenji",
  "Lena",
  "Omar",
  "Priya",
  "Lucas",
  "Ines",
  "Tomasz",
  "Chloe",
  "Yusuf",
  "Hana",
  "Diego",
  "Freya",
  "Kwame",
  "Mei",
  "Arjun",
  "Elif",
  "Noah",
] as const;

export const LOCATIONS = [
  { city: "Sofia", country: "BG" },
  { city: "Berlin", country: "DE" },
  { city: "Lisbon", country: "PT" },
  { city: "London", country: "GB" },
  { city: "Toronto", country: "CA" },
  { city: "Austin", country: "US" },
  { city: "São Paulo", country: "BR" },
  { city: "Bengaluru", country: "IN" },
  { city: "Tokyo", country: "JP" },
  { city: "Lagos", country: "NG" },
  { city: "Warsaw", country: "PL" },
  { city: "Melbourne", country: "AU" },
] as const;

export const DEVICES: readonly { device: DeviceType; weight: number; os: readonly string[] }[] = [
  { device: "desktop", weight: 0.62, os: ["macOS", "Windows", "Linux"] },
  { device: "mobile", weight: 0.31, os: ["iOS", "Android"] },
  { device: "tablet", weight: 0.07, os: ["iPadOS", "Android"] },
];

export const BROWSERS = ["Chrome", "Chrome", "Safari", "Firefox", "Edge"] as const;

export const REFERRERS = [
  null,
  null,
  "google.com",
  "news.ycombinator.com",
  "linkedin.com",
  "github.com",
  "newsletter",
] as const;
