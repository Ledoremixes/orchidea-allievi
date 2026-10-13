# Presenze dall’app allievi

La nuova pagina `/presenze`, raggiungibile dal menu e dalla Home, permette di registrare la propria presenza e consultare le ultime 100 lezioni frequentate.

La registrazione usa il registro `presenze_corsi` esistente ed è visibile alla segreteria. L’identità viene ricavata dall’account autenticato tramite `get_my_tesseramento()`, già usata dall’app: non viene accettato un identificativo allievo dal client. Data e orario vengono calcolati dal server nel fuso Europe/Rome. Non è prevista una verifica della posizione fisica.

Sono ammessi solo corsi attivi del giorno con iscrizione attiva, rinnovo attivo e date valide, per tesseramenti attivi. Il check-in è disponibile da 30 minuti prima dell’inizio fino alla fine della lezione. Per le lezioni consecutive, ogni presenza dall’app viene registrata nella propria finestra; il check-in multiplo del tablet resta invariato.

Le doppie registrazioni, anche tra tablet e app, sono impedite dal vincolo univoco esistente. Non vengono concesse agli allievi scritture dirette sulla tabella. Le due nuove funzioni sono accessibili soltanto al ruolo authenticated e controllano anche l’identità nella richiesta.

## Attivazione

1. Sul database effettivamente usato da Orchidea, che deve già contenere lo schema dello step 14 e gli aggiornamenti in uso, eseguire `supabase/migrations/20261013065853_student_course_attendance.sql`. Non eseguire gli script storici da zero sul database di produzione.
2. Pubblicare questa versione frontend tramite il flusso di rilascio esistente.
3. Con un account allievo di test iscritto a una lezione nella finestra consentita, registrare una presenza e verificare lo storico personale e il registro amministrativo. Verificare anche il layout su smartphone.

La migrazione non è stata applicata al database di produzione: il progetto Orchidea non compare tra i progetti Supabase disponibili in questa sessione. Non sono state registrate presenze reali.

## Verifiche locali

`npm ci`, `npm test`, `npm run build`.

Il test SQL usa un database PostgreSQL temporaneo PGlite e dati sintetici. Verifica accesso anonimo negato, account non collegato, registrazione con ruolo authenticated, duplicati, autore/sorgente, tessera inattiva, rinnovo disattivato, iscrizione scaduta/futura, corso inattivo/giorno errato e finestra oraria. Non sostituisce la verifica con le policy e i trigger del database reale.
