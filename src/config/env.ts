export interface TandemEnv {
  apiKey: string;
  baseUrl: string;
}

export function loadEnv(): TandemEnv {
  const apiKey = process.env["DEEPSEEK_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY nije postavljen. Kopiraj .env.example u .env i popuni ključ."
    );
  }

  return {
    apiKey,
    baseUrl: process.env["DEEPSEEK_BASE_URL"] ?? "https://api.deepseek.com",
  };
}
