# Orchidea Allievi - Presenze corsi

## Cosa è stato modificato

- Rimossa la voce Quote/Pagamenti dalla navigazione degli allievi.
- Rimossi dal pannello admin i menu Pagamenti e Insegnanti/compensi.
- Dashboard admin trasformata in dashboard presenze.
- Nuova sezione admin **Presenze** con:
  - registro filtrabile per mese e corso;
  - check-in in tempo reale;
  - inserimento manuale e cancellazione;
  - esportazione CSV;
  - presenze, assenze stimate, ore frequentate, frequenza media;
  - report per corso e classifica allievi più assidui.
- Nuova pagina tablet `/check-in`.
- Dopo un check-in valido appare il messaggio grande:
  - `Benvenuto, NOME!`
  - corso, livello e orario della lezione.
- Il corso viene riconosciuto automaticamente usando giorno e orario configurati nella sezione Corsi.
- Se nello stesso momento ci sono più corsi, il sistema usa prima l’iscrizione dell’allievo per riconoscere automaticamente la lezione; chiede una scelta solo se l’allievo risulta iscritto a più corsi contemporanei.
- Il check-in accetta numero tessera completo, parte numerica finale della tessera oppure cellulare.
- Le presenze duplicate nella stessa lezione vengono bloccate.
- Il tablet accetta la presenza soltanto quando tessera e iscrizione al corso sono attive.
- L’area Corsi/Iscrizioni non mostra più prezzi, formule o quote: la gestione economica resta in Nova.

## Passaggio obbligatorio su Supabase

1. Aprire **Supabase > SQL Editor**.
2. Aprire il file `supabase/step-14-presenze-corsi.sql` contenuto nel progetto.
3. Copiare tutto il contenuto, eseguirlo e verificare che non compaiano errori.
4. Pubblicare nuovamente il progetto su Vercel.

## Uso del tablet

1. Accedere una volta con un account admin.
2. Dal pannello admin premere **Apri modalità tablet** oppure aprire `/check-in`.
3. Premere **Schermo intero**.
4. Lasciare il tablet sulla schermata di check-in.

La pagina `/check-in` richiede una sessione admin per evitare di esporre l’anagrafica dei tesserati. Gli allievi possono soltanto inserire il proprio identificativo nell’interfaccia chiosco.

## Logica degli orari

Il check-in è disponibile da 45 minuti prima dell’inizio fino a 45 minuti dopo la fine del corso. Il fuso orario usato è `Europe/Rome`.

## Verifiche eseguite

- Controllo strutturale di tutti i file JavaScript/JSX e degli import relativi: superato.
- Controllo Git degli errori di whitespace: superato.
- Verifica di assenza delle rotte e dei collegamenti visibili alla vecchia pagina Pagamenti: superata.
- La cartella `dist` precedente è stata rimossa perché conteneva la vecchia build con i pagamenti. Verrà rigenerata con `npm run build` durante il deploy.

In questo ambiente non è stato possibile scaricare le dipendenze npm, quindi la build Vite completa deve essere eseguita dopo `npm install` sul computer di sviluppo oppure automaticamente da Vercel.
