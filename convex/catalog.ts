import type { CatalogApp } from "../src/lib/contract";

export const CATALOG: CatalogApp[] = [
  {
    slug: "myfitnesspal",
    name: "MyFitnessPal",
    category: "nutrition",
    route: "web",
    loginUrl: "https://www.myfitnesspal.com/account/login",
    webOrigin: "https://www.myfitnesspal.com",
    blurb: "Log food and read your diary, calories and macros.",
  },
  {
    slug: "strong",
    name: "Strong",
    category: "training",
    route: "cloudPhone",
    androidPackage: "io.strongapp.strong",
    revylAppId: "2bab1be3-763b-4a29-8580-83b56aa475f4",
    blurb: "Log workouts and read your training history.",
  },
  {
    slug: "parkmobile",
    name: "ParkMobile",
    category: "other",
    route: "web",
    loginUrl: "https://app.parkmobile.io/login",
    webOrigin: "https://app.parkmobile.io",
    blurb: "Find zones and prices near you, see active sessions.",
  },
  {
    slug: "duolingo",
    name: "Duolingo",
    category: "other",
    route: "web",
    loginUrl: "https://www.duolingo.com/log-in",
    webOrigin: "https://www.duolingo.com",
    blurb: "Streak, XP, weak words and your league.",
  },
];

// Paused: not listed, not connectable. Move back into CATALOG when its recipe is ready.
export const PAUSED: CatalogApp[] = [
  {
    slug: "flo",
    name: "Flo",
    category: "cycle",
    route: "cloudPhone",
    androidPackage: "org.iggymedia.periodtracker",
    blurb: "Log symptoms and read your cycle.",
  },
];

export function catalogApp(slug: string): CatalogApp | undefined {
  return CATALOG.find((a) => a.slug === slug);
}

// Loose match for the assistant's connect_app({ app }): slug, name, or a prefix of either.
export function findApp(query: string): CatalogApp | undefined {
  const q = query.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!q) return undefined;
  return (
    CATALOG.find((a) => a.slug === q || a.name.toLowerCase().replace(/[^a-z0-9]/g, "") === q) ??
    CATALOG.find((a) => a.slug.startsWith(q) || q.startsWith(a.slug)) ??
    (q === "mfp" ? catalogApp("myfitnesspal") : undefined)
  );
}
