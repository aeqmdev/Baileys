# Unreleased
- Fork documentation integrated into the main README; `README_AEQM.md` and `.github/README.md` now point to it
- Types: optional `participantsInfo` in `group-participants.update`; `getPNById`/`getLIDById` added to the socket type (optional and absent when `lidHelpers: false`)
- `test:e2e` split into `test:e2e:mock` (TLS bypass limited to the process connecting to the mock) and `test:e2e:live` (TLS verification enabled)
- New tests: participant events, LID/PN fields, LID helpers, pinning, `buttonsMode`, and the button documentation/type contract

# 1.0.0
- Base: Baileys 7.0.0-rc14
- Buttons, lists, and interactive messages (`nativeFlow`) with biz nodes
- ChatUnity compatibility: key.senderPn/senderLid/participantLid, getPNById/getLIDById, participant.jid, string[] participants, and pinning
