import type { ToolDefinition } from "../agent/types.js";

interface WeatherToolOptions {
  fetchImpl?: typeof fetch;
}

interface WeatherApiResponse {
  current_condition?: Array<{
    FeelsLikeC?: string;
    FeelsLikeF?: string;
    humidity?: string;
    localObsDateTime?: string;
    temp_C?: string;
    temp_F?: string;
    weatherDesc?: Array<{ value?: string }>;
    winddir16Point?: string;
    windspeedKmph?: string;
    windspeedMiles?: string;
  }>;
  nearest_area?: Array<{
    areaName?: Array<{ value?: string }>;
    region?: Array<{ value?: string }>;
    country?: Array<{ value?: string }>;
  }>;
}

function readNestedValue(items: Array<{ value?: string }> | undefined): string | undefined {
  const value = items?.[0]?.value?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function createGetWeatherTool(options: WeatherToolOptions = {}): ToolDefinition {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "get_weather",
    description:
      "Get the current weather for a city or location. Use this for plain current-weather questions instead of browser search.",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "City, region, or place name to check."
        }
      },
      required: ["location"],
      additionalProperties: false
    },
    async execute(input) {
      const location = typeof input.location === "string" ? input.location.trim() : "";
      if (location.length === 0) {
        return JSON.stringify({
          ok: false,
          error: "location must be a non-empty string."
        });
      }

      const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;

      try {
        const response = await fetchImpl(url, {
          headers: {
            Accept: "application/json"
          }
        });

        if (!response.ok) {
          return JSON.stringify({
            ok: false,
            error: `Weather request failed with status ${response.status}.`
          });
        }

        const payload = (await response.json()) as WeatherApiResponse;
        const current = payload.current_condition?.[0];
        if (!current) {
          return JSON.stringify({
            ok: false,
            error: "Weather service did not return current conditions."
          });
        }

        const area = payload.nearest_area?.[0];
        const areaName = readNestedValue(area?.areaName);
        const region = readNestedValue(area?.region);
        const country = readNestedValue(area?.country);
        const description = readNestedValue(current.weatherDesc);

        return JSON.stringify({
          ok: true,
          location,
          resolvedLocation: [areaName, region, country]
            .filter((value): value is string => Boolean(value))
            .join(", "),
          observedAt: current.localObsDateTime ?? null,
          condition: description ?? null,
          temperatureC: current.temp_C ?? null,
          temperatureF: current.temp_F ?? null,
          feelsLikeC: current.FeelsLikeC ?? null,
          feelsLikeF: current.FeelsLikeF ?? null,
          humidity: current.humidity ?? null,
          windKmph: current.windspeedKmph ?? null,
          windMph: current.windspeedMiles ?? null,
          windDirection: current.winddir16Point ?? null
        });
      } catch (error) {
        return JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  };
}
