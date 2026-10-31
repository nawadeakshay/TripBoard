// External API calls.
import { REST_COUNTRIES_API_KEY } from "./config.js";

// API 1: REST Countries (v5 — v3.1 now returns a "deprecated" error). Returns a simplified country object.
export async function fetchCountry(name) {
  const url = `https://api.restcountries.com/countries/v5/name?q=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${REST_COUNTRIES_API_KEY}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404) throw new Error(`No country found for "${name}".`);
    throw new Error(body.errors?.[0]?.message || `REST Countries error (${res.status}).`);
  }
  const list = body.data?.objects || [];
  if (!list.length) throw new Error(`No country found for "${name}".`);

  // The search is a substring match ("india" also returns "British Indian Ocean Territory"),
  // so prefer an exact common/official name match, else take the first result.
  const q = name.trim().toLowerCase();
  const c =
    list.find((x) => x.names.common.toLowerCase() === q || x.names.official.toLowerCase() === q) ||
    list[0];

  const currencies = (c.currencies || [])
    .map((cur) => `${cur.name} (${cur.code}${cur.symbol ? `, ${cur.symbol}` : ""})`)
    .join(", ");
  const capitals = c.capitals || [];
  const primaryCapital = capitals.find((x) => x.attributes?.primary) || capitals[0];

  return {
    code: c.codes?.alpha_2,
    name: c.names.common,
    officialName: c.names.official,
    flagUrl: c.flag?.url_png || `https://flags.restcountries.com/v5/w320/${c.codes?.alpha_2?.toLowerCase()}.png`,
    flagAlt: `Flag of ${c.names.common}`,
    capital: capitals.map((x) => x.name).join(", ") || "—",
    population: c.population,
    region: c.region,
    currency: currencies || "—",
    lat: primaryCapital?.coordinates?.lat ?? null,
    lng: primaryCapital?.coordinates?.lng ?? null,
    isDemo: Boolean(body.data?._demo), // demo key returns a fixed sample, not the searched country
  };
}

// API 2: Open-Meteo current weather for given coordinates.
export async function fetchWeather(lat, lng) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,wind_speed_10m`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo error (${res.status}).`);
  const data = await res.json();
  return {
    temperature: data.current.temperature_2m,
    tempUnit: data.current_units.temperature_2m,
    windSpeed: data.current.wind_speed_10m,
    windUnit: data.current_units.wind_speed_10m,
    time: data.current.time,
  };
}

// The chain: country first, then weather using the capital's coordinates from the country result.
export async function fetchCountryWithWeather(name) {
  const country = await fetchCountry(name);
  let weather = null;
  let weatherError = null;
  if (country.lat != null && country.lng != null) {
    try {
      weather = await fetchWeather(country.lat, country.lng);
    } catch (e) {
      weatherError = e.message; // country info is still useful if weather fails
    }
  } else {
    weatherError = "No capital coordinates available for this country.";
  }
  return { country, weather, weatherError };
}
