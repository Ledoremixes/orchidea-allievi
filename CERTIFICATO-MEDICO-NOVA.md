# Certificato medico: Orchidea Allievi ↔ Nova

## Funzionamento

Nel Profilo dell'app è presente una scheda **Certificato medico** che mostra:
- **Non presente** se nel database Nova non risulta alcuna visita medica associata al tesseramento.
- **Valido** se `status = valida` e la scadenza è oltre i prossimi 30 giorni.
- **In scadenza** se valido ma con scadenza entro 30 giorni (oggi incluso).
- **Scaduto** se `expires_at` precede la data odierna italiana, anche quando Nova aveva salvato `status = valida`.
- **Da verificare** se `status != valida` oppure manca la data di scadenza.
- Data di rilascio, scadenza e **Scarica certificato** se esiste il file.

Le informazioni sono lette **direttamente** dalla tabella Nova `public.medical_visits`.
Il certificato è conservato nel bucket **privato** Nova `medical-visits`. Non viene copiato in un nuovo bucket o duplicato nel DB Orchidea; le modifiche fatte in Nova sono visibili nell'app al successivo caricamento della scheda.

## Configurazione necessaria — solo una volta

Nova e Orchidea Allievi hanno database Supabase separati. Su **Supabase del progetto Orchidea Allievi** (`website`, ref `egiszddctzwamzndsbtx`):

1. Aprire **Edge Functions → Secrets** e aggiungere:
   - `NOVA_SUPABASE_URL` = URL Supabase usato come `VITE_SUPABASE_URL` nel progetto **Nova**.
   - `NOVA_SUPABASE_SERVICE_ROLE_KEY` = chiave **service_role/secret** del medesimo progetto **Nova**.
2. Da terminale nella cartella Orchidea Allievi, con Supabase CLI autenticata:
   ```bash
   npx supabase functions deploy student-medical-certificate --project-ref egiszddctzwamzndsbtx
   ```
3. La funzione deve avere **JWT verification abilitata** (impostazione predefinita). Accertarsi che il dominio dell'app carichi le normali variabili **VITE_SUPABASE_URL** e **VITE_SUPABASE_ANON_KEY** del database Orchidea, NON quelle di Nova.

**Non inserire mai `NOVA_SUPABASE_SERVICE_ROLE_KEY` in `.env`, in variabili `VITE_`, nel repository GitHub o nel codice browser.** La chiave deve essere configurata esclusivamente come secret della Edge Function. Il bucket Nova deve restare privato.

## Privacy e collegamento utente

- Il frontend invia il JWT autenticato Orchidea, mai un ID allievo scelto dal browser.
- La funzione verifica il JWT con Supabase Auth, poi usa **solo il collegamento esatto** `tesseramenti.auth_user_id = user.id` sul database Orchidea.
- L'accesso viene negato se mancano collegamenti o se sono ambigui. Non viene mai risolto mediante e-mail, perché e-mail condivise possono riferirsi a più persone.
- Solo dopo il controllo dell'identità viene interrogata la riga Nova con `medical_visits.tesseramento_id = tesseramenti.id`.
- Vengono restituiti **solo** stato e date. Per il download la funzione genera un URL firmato con durata 90 secondi, utilizzabile dal suo possessore fino alla scadenza.
- In caso di errore di rete/collegamento Nova non viene mostrato “Non presente”, ma “Verifica non disponibile”, con pulsante **Riprova**.
- Se Nova ha registrato la visita senza allegato, le date e lo stato restano visibili ma il pulsante di download non compare.

## Verifica funzionale

1. In Nova caricare per un corsista una visita con rilascio, scadenza e foto/PDF; assicurarsi che il **tesseramento_id** sia quello di Orchidea Allievi.
2. Nel profilo dello stesso corsista aprire **Certificato medico**: le date devono coincidere e il pulsante scaricare **soltanto il proprio** documento.
3. Provare una scadenza di ieri, una tra 20 giorni, una oltre 30 giorni e una visita in stato `da_verificare`.
4. Provare un utente senza visita: **Non presente**. Provare una funzione non configurata: **Verifica non disponibile**.
5. Provare un account non collegato con `tesseramenti.auth_user_id`: il server deve negare accesso, anche se l'e-mail del tesseramento corrisponde all'e-mail dell'account.

## Avvio locale

```bash
npm ci
npm run dev
```

La versione locale usa la Edge Function **remota** del progetto Orchidea. Il database Nova non deve essere configurato nella Vite app. La prima verifica richiede i due secret e il deploy della funzione; prima di questi passaggi la scheda mostrerà **Verifica non disponibile**, non una falsa assenza di certificato.
