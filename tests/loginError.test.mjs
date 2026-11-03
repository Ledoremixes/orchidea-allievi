import test from "node:test";
import assert from "node:assert/strict";
import { loginErrorMessage } from "../src/lib/loginError.js";

test("login distinguishes credentials, confirmation, rate limits and service failures", () => {
  assert.match(loginErrorMessage({ code: "invalid_credentials", status: 400 }), /Email o password non corrette/);
  assert.match(loginErrorMessage({ code: "email_not_confirmed", status: 400 }), /Conferma la tua email/);
  assert.match(loginErrorMessage({ status: 429 }), /Troppi tentativi/);
  assert.match(loginErrorMessage({ status: 503 }), /temporaneamente non disponibile/);
  assert.match(loginErrorMessage(), /connessione/);
});

test("unknown errors never display raw server messages or submitted data", () => {
  const message = loginErrorMessage({ message: "sensitive server details", status: 400 });
  assert.doesNotMatch(message, /sensitive server details/);
  assert.doesNotMatch(message, /credenziali non valide/i);
});
