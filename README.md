# Mis Notas

App para ver tus ramos, poner tus notas y saber cuánto necesitas en el examen.
El catálogo de ramos es compartido: lo que agrega una persona lo ven todos.

## Piezas
- `index.html`, `app.js`, `config.js`: la página (sin build, HTML + JS).
- `catalogo.json`: catálogo inicial (también se usa en modo demo).
- `api/extraer.js`: función de Vercel que lee un PDF o texto dictado con Claude y devuelve el ramo en JSON.
- `supabase/schema.sql`: tablas y permisos. `supabase/seed.sql`: catálogo inicial.

## Puesta en marcha
1. **Supabase** → New project → SQL Editor: pega y corre `supabase/schema.sql` y después `supabase/seed.sql`.
   En Authentication → URL Configuration pon la URL de Vercel como *Site URL*.
2. **config.js**: pega la *Project URL* y la *anon public key* de Supabase (son públicas).
3. **Vercel** → Add New Project → importa el repositorio de GitHub. En *Environment Variables* agrega:
   - `ANTHROPIC_API_KEY` (de console.anthropic.com, **secreta**)
   - `SUPABASE_URL` y `SUPABASE_ANON_KEY` (las mismas de config.js)
4. Deploy. Cada `git push` actualiza la página para todos.

Si `config.js` está vacío, la app funciona en **modo demo** (todo se guarda en el navegador).
