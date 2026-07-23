# Correzione importi a zero - 23/07/2026

- Le quote con `pagamenti.importo = 0` vengono ora ricostruite dalla tariffa dell'iscrizione attiva.
- Il fallback usa, in ordine: `iscrizioni_corsi.tariffa_mensile`, `corsi.prezzo_mensile`, totale del pacchetto attivo.
- Le vecchie quote mensili generiche senza `iscrizione_id` o `corso_id` usano il totale mensile dei corsi attivi.
- Dashboard e pagina Pagamenti condividono la stessa logica.
- Aggiunto aggiornamento periodico ogni 12 secondi quando l'app è visibile, oltre a Supabase Realtime e refresh al ritorno nell'app.
- Build di produzione verificata.
