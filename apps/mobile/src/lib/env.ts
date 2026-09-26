/** Public build-time config (EXPO_PUBLIC_* are inlined by Metro). */
export const ENV = {
  apiBaseUrl: (process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  voiceModel: process.env.EXPO_PUBLIC_GROK_VOICE_MODEL ?? "grok-voice-latest",
  voiceReasoningEffort: (process.env.EXPO_PUBLIC_VOICE_REASONING_EFFORT === "high" ? "high" : "none") as "none" | "high",
};
