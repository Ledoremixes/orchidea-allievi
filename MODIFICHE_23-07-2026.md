# Modifiche 23/07/2026

## Pagamenti
- Le quote con stato `annullato` non vengono più conteggiate come da pagare.
- Il riepilogo del mese considera solo le quote che coprono il mese corrente.
- Quando Nova registra il saldo mensile con una riga unica, Orchidea Allievi riconcilia le righe ripartite dei corsi e non mostra più residui duplicati.
- I pacchetti multicorso vengono mostrati come un'unica voce leggibile.
- I dati vengono aggiornati al ritorno nell'app e tramite Supabase Realtime, senza dover ricaricare manualmente la pagina.

## Mobile
- Navbar inferiore centrata tramite inset laterali e griglia dinamica a 5/6 voci.
- Corretto il taglio della voce Admin sui telefoni più stretti.
- Migliorata la leggibilità delle quote, dello stato mensile e dello storico.

## Verifica
- Build di produzione completata correttamente con `npm run build`.
- Non è richiesto alcun nuovo script SQL.

## Correzione quote che ricomparivano dopo l'eliminazione

- Rimossa la generazione automatica delle quote all'apertura della sezione Pagamenti.
- Una quota eliminata da Nova, da Orchidea Allievi o direttamente da Supabase non viene più reinserita automaticamente.
- Le quote mancanti possono essere create soltanto con un'azione esplicita dell'amministratore tramite i pulsanti di generazione.
- Le iscrizioni attive continuano a comparire nella dashboard amministrativa come “Da generare”, ma non producono righe nella tabella `pagamenti` finché non si conferma la generazione.
