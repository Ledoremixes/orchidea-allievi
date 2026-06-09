# Deploy app Orchidea Allievi su GitHub + Vercel

## GitHub

1. Apri il progetto con Visual Studio Code.
2. Apri il terminale nella cartella principale del progetto.
3. Esegui:

```powershell
npm install
npm run build
git init
git add .
git commit -m "Prima pubblicazione app allievi Orchidea"
git branch -M main
git remote add origin https://github.com/Ledoremixes/orchidea-allievi.git
git push -u origin main
```

Se il repository esiste già e il remote dà errore:

```powershell
git remote set-url origin https://github.com/Ledoremixes/orchidea-allievi.git
git push -u origin main
```

## Vercel

1. Entra su Vercel con l'account `manuelledoremixes`.
2. Clicca `Add New Project`.
3. Importa il repository GitHub `Ledoremixes/orchidea-allievi`.
4. Imposta:
   - Framework Preset: `Vite`
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`
5. Aggiungi le variabili ambiente:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. Clicca `Deploy`.

## Nota importante

Il file `vercel.json` serve per far funzionare correttamente il refresh delle pagine interne come `/tessera`, `/corsi`, `/pagamenti`.
