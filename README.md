# Orchidea Allievi - Step 8

Questa versione aggiunge una gestione più chiara dei pagamenti corsi per la segreteria.

## Novità principali

### Calendario pagamenti mensile

Nella sezione `Admin > Pagamenti` ora la tabella separa:

- quota del singolo mese
- totale del pagamento
- copertura del pagamento
- stato della quota
- modifica rapida della scheda corso/pagamento

Esempio:

- Manuel paga trimestrale Bachata 120 € a ottobre
- la quota mensile resta 40 €
- ottobre, novembre e dicembre risultano coperti
- in ogni mese viene mostrato 40 €/mese
- il totale del pagamento resta 120 €
- la copertura risulta fino al 31 dicembre

### Modifica singolo corso dal calendario

Ogni riga della tabella pagamenti ha il pulsante `✎ Modifica`.

Da lì la segretaria può cambiare:

- modalità pagamento: mensile, trimestrale, annuale, All You Can Dance
- quota del singolo mese
- totale pagamento del periodo
- data inizio copertura
- data fine copertura
- stato pagamento
- stato del corso dell'allievo
- generazione quote future
- se il corso genera pagamento oppure no

La modifica della modalità e della quota mensile viene salvata sull'iscrizione, quindi i mesi successivi useranno automaticamente i nuovi valori.

### Cambio formula nel tempo

Caso pratico:

- ottobre: trimestrale Bachata 120 €, copertura ottobre/novembre/dicembre
- gennaio: la segretaria apre la riga di gennaio e cambia formula in mensile
- da gennaio in poi il sistema usa mensile 40 €, o l'importo nuovo scelto

I pagamenti vecchi rimangono storici e non vengono sovrascritti.

### Area corsi allievo

Nella pagina `Corsi` dell'allievo ora viene mostrato:

- quota mensile
- pagamento coperto fino a una certa data
- totale versato e mesi coperti

## SQL da eseguire

Su Supabase esegui:

```txt
supabase/step-8-calendario-pagamenti.sql
```

È uno script conservativo: non cancella dati, aggiunge indici e garantisce le colonne usate dalla dashboard.

## File modificati

```txt
src/pages/admin/AdminPanel.jsx
src/pages/Corsi.jsx
src/styles/global.css
supabase/step-8-calendario-pagamenti.sql
README.md
```

## Avvio

```bash
npm install
npm run dev
```

## Build testato

```bash
npm run build
```

Il warning sul bundle grande è normale e non blocca il funzionamento.

## Step 9 - Corsi come schede e dettaglio iscritti

Nella sezione Admin → Corsi i corsi sono ora mostrati come schede separate.

Ogni scheda mostra:

- nome, livello, giorno, orario e sala;
- prezzo mensile base;
- numero totale iscritti;
- iscritti attivi;
- iscritti sospesi;
- pulsante per aprire i dettagli del corso;
- pulsante matita per modificare il corso;
- pulsante per attivare/disattivare il corso.

Aprendo i dettagli del corso si apre una finestra modale con:

- riepilogo del corso;
- iscritti totali, attivi, sospesi e terminati;
- prezzo base;
- totale incassato per quel corso;
- elenco completo degli iscritti al corso;
- numero tessera, email, telefono, formula di pagamento, quota mensile e stato iscrizione;
- accesso rapido alla scheda dell'allievo;
- azione rapida per sospendere o riattivare l'iscrizione.

Non richiede nuove query SQL: usa le tabelle già presenti `corsi`, `iscrizioni_corsi`, `tesseramenti` e `pagamenti`.


## Step 10 - Eliminazione righe pagamenti/iscrizioni

Nella sezione **Pagamenti** ora ogni riga ha anche:

- **Elimina quota**: elimina solo la quota generata, lasciando attiva l'iscrizione al corso.
- **Elimina riga**: elimina l'iscrizione dell'allievo a quel corso e cancella le quote non pagate collegate. I pagamenti già segnati come pagati rimangono nello storico.

Nel dettaglio di un corso è disponibile lo stesso pulsante **Elimina riga** sugli iscritti, utile quando un allievo è stato inserito per errore o non deve più risultare collegato a quel corso.

Per fermare un corso senza eliminare lo storico, usa invece **Chiudi corso**.

## Step 11 - Scheda allievo: corsi compatti e modifica in popup

Nella scheda allievo la sezione **Iscrizioni e prezzi** è stata riorganizzata:

- i corsi sono ora mostrati come righe compatte;
- il nome del corso è evidenziato in giallo;
- ogni riga ha la matita per aprire il dettaglio;
- la modifica di formula, importo mensile, stato corso, data inizio, generazione quote e pagamento avviene in un popup dedicato;
- la lista corsi ha scroll verticale, quindi si vedono e gestiscono comodamente anche tanti corsi associati allo stesso allievo.

Non serve nuovo SQL per questo step.

## Step 12 — Pacchetti multicorso proporzionali

Prima di usare questa versione esegui su Supabase:

```txt
supabase/step-12-pacchetti-multicorso.sql
```

La sezione **Iscrizioni** ora permette di creare un pacchetto multicorso: selezioni più corsi, inserisci il totale mensile realmente pagato dall'allievo e il sistema divide automaticamente quella quota in proporzione ai prezzi base dei corsi.

Esempio:

```txt
Country 30 €
Bachata Fusion 45 €
Lady Style 40 €
Salsa 40 €
Totale pieno 155 €
Pacchetto concordato 120 €
```

Il sistema salva una quota mensile ripartita su ogni iscrizione. In questo modo la dashboard pagamenti non mostra più i prezzi pieni, ma la quota corretta del pacchetto. Quando verranno aggiunte le quote insegnanti/Orchidea, ogni corso avrà già il proprio importo proporzionale.

Se un pagamento appartiene a un pacchetto, il pulsante **Segna pacchetto pagato** aggiorna tutte le righe dello stesso pacchetto nello stesso mese.

## Step 13 — Gestione pacchetti dalla scheda allievo

Nella scheda allievo, sezione **Iscrizioni e prezzi**, è stato aggiunto il pulsante **Gestisci pacchetto**.

Da questo popup la segreteria può:

- vedere tutti i corsi collegati all'allievo;
- includere o togliere corsi dal pacchetto;
- impostare il totale mensile del pacchetto;
- cambiare formula di pagamento: mensile, trimestrale, annuale o All You Can Dance;
- scegliere da quale mese applicare la modifica;
- terminare o sospendere un corso;
- ricalcolare automaticamente la quota mensile di ogni corso in modo proporzionale al prezzo base.

Esempio: se un allievo aveva 4 corsi a pacchetto e il mese successivo ne chiude uno, la segreteria apre **Gestisci pacchetto**, imposta il nuovo totale mensile e salva. Il sistema aggiorna le iscrizioni e le quote future non pagate. I pagamenti già segnati come pagati restano nello storico.

Non serve nuovo SQL rispetto allo step 12.

## Step 14 - CSS scheda allievo

La scheda allievo è stata rifinita graficamente: la sezione “Iscrizioni e prezzi” ora usa una lista compatta e leggibile, il pacchetto non viene più mostrato come bolla enorme e il box pagamenti è più ordinato con importi e stati separati.
