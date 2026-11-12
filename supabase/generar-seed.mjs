// Genera supabase/seed.sql a partir de catalogo.json:  node supabase/generar-seed.mjs
import fs from 'fs';
const cat = JSON.parse(fs.readFileSync(new URL('../catalogo.json', import.meta.url)));
const q = s => s == null ? 'null' : "'" + String(s).replace(/'/g, "''") + "'";
const rows = cat.map(r => `(${q(r.sigla)}, ${q(r.nombre)}, ${q(r.universidad || 'UC')}, ${q(r.carrera)}, ${q(r.periodo)}, ${q(r.fuente)}, ${q(JSON.stringify(r.def))}::jsonb, null)`);
fs.writeFileSync(new URL('./seed.sql', import.meta.url),
`-- Catálogo inicial (${cat.length} ramos). Pegar en Supabase → SQL Editor → Run, después de schema.sql
insert into public.ramos (sigla, nombre, universidad, carrera, periodo, fuente, def, creado_por) values
${rows.join(',\n')}
on conflict do nothing;
`);
console.log('seed.sql con', cat.length, 'ramos');
