# Non rilasciato
- Documentazione della fork integrata nel README principale; `README_AEQM.md` e `.github/README.md` ora rimandano a quello
- Tipi: `participantsInfo` opzionale in `group-participants.update`; `getPNById`/`getLIDById` presenti nel tipo del socket (opzionali, assenti con `lidHelpers: false`)
- `test:e2e` diviso in `test:e2e:mock` (deroga TLS limitata al processo che parla col mock) e `test:e2e:live` (verifica TLS attiva)
- Nuovi test: eventi partecipanti, campi LID/PN, helper LID, pin, `buttonsMode`, contratto documentazione/tipi dei pulsanti

# 1.0.0
- Base: Baileys 7.0.0-rc14
- Pulsanti, liste, messaggi interattivi (nativeFlow) con nodi biz
- Compatibilità ChatUnity: key.senderPn/senderLid/participantLid, getPNById/getLIDById, participant.jid, participants string[], pin
