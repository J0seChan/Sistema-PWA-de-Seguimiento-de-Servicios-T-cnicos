# Despliegue en GitHub Pages

1. Crea el repositorio en GitHub y sube el proyecto (`.env` está en `.gitignore`: no se sube).
   ```bash
   git init && git add . && git commit -m "Link Redes Servicios"
   git branch -M main && git remote add origin https://github.com/USUARIO/REPO.git && git push -u origin main
   ```
2. *Settings → Pages → Build and deployment → Source*: **GitHub Actions**.
3. *Settings → Secrets and variables → Actions → pestaña Variables*: crea `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (son públicas por diseño; la protección real es RLS).
4. Cada push a `main` ejecuta `.github/workflows/deploy.yml` (pruebas + build + publicación).
5. Abre `https://USUARIO.github.io/REPO/` en Chrome Android → menú → **Instalar aplicación**. Ábrela una vez con Internet para que quede disponible sin conexión.
6. Agrega esa URL en Supabase (*Authentication → URL Configuration*).

El build usa rutas relativas (`base: './'`) y enrutado por `#`, por eso funciona bajo `/REPO/` sin configurar nada y sin 404 al recargar.

Para publicar una versión nueva basta con un push; los usuarios verán el aviso "Hay una versión nueva" y deciden cuándo actualizar.

## Fase 2
No hay variables nuevas en GitHub. La Edge Function `admin-users` se despliega **en Supabase** (ver `docs/SUPABASE_SETUP.md`, paso 3), no en GitHub Pages.
