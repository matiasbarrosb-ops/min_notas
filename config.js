// Configuración pública de la app. La URL y la anon key de Supabase son públicas (se pueden ver en el navegador).
// La API key de Claude NUNCA va acá: va en las variables de entorno de Vercel (ANTHROPIC_API_KEY).
// Si supabaseUrl está vacío, la app funciona en "modo demo" (datos guardados solo en este navegador).
window.APP_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  apiUrl: '/api/extraer'
};
