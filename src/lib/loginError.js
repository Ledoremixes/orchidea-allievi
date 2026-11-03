export function loginErrorMessage(error) {
  if (error?.code === "email_not_confirmed") {
    return "Conferma la tua email tramite il link ricevuto prima di accedere.";
  }
  if (error?.status === 429) {
    return "Troppi tentativi di accesso. Attendi qualche minuto e riprova.";
  }
  if (error?.status >= 500) {
    return "Il servizio di accesso è temporaneamente non disponibile. Riprova tra poco.";
  }
  if (error?.code === "invalid_credentials") {
    return "Email o password non corrette. Controlla la password con l’icona occhio. Se hai già un account usa “Password dimenticata”; altrimenti usa “Primo accesso”.";
  }
  return "Impossibile completare l’accesso. Controlla la connessione e riprova.";
}
