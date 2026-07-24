# Fix home e nuova sezione eventi

## Correzione home
- Risolto il riquadro "Situazione pagamenti" compresso in una colonna stretta sui desktop.
- Il pannello ora occupa tutta la larghezza e mantiene un layout leggibile e responsive.

## Eventi e serate
- Nuova pagina `/eventi`.
- Nuovo accesso rapido dalla Home e dalla barra di navigazione.
- Lettura automatica delle tabelle Supabase `events` e `posters` usate dal sito web.
- Unione, ordinamento cronologico e rimozione dei duplicati.
- Vengono mostrati solo gli appuntamenti futuri.
- Locandina, data, orario, luogo e descrizione sono mostrati senza duplicare i dati.
- Anteprima dei prossimi tre appuntamenti direttamente nella Home.

## Supabase
Eseguire `supabase/step-16-eventi-app-allievi.sql` soltanto se gli eventi non risultano visibili agli utenti autenticati. Lo script aggiunge le policy di sola lettura per `events` e `posters`.
