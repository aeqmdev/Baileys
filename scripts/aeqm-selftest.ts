import assert from 'node:assert/strict'
import { applyAeqmCompat } from '../src/Socket/aeqm'
import {
	buildInteractiveMessage, collectNativeFlowButtons, getButtonReplyId, getInteractiveBizNodes,
	hasInteractiveContent, wrapInteractiveMessage
} from '../src/Utils/aeqm-buttons'
import {
	applyLegacyKeyFields, normalizeParticipant, normalizePinContent, toLegacyParticipantsUpdate
} from '../src/Utils/aeqm-compat'
import { EventEmitter } from 'node:events'

// --- Legacy quick-reply buttons
const content = { text: 'hello', footer: 'f', buttons: [{ buttonId: '.menu admin', buttonText: { displayText: 'Admin' } }] }
assert.ok(hasInteractiveContent(content))
assert.ok(!hasInteractiveContent({ text: 'x' }))
const nf = collectNativeFlowButtons(content)
assert.deepEqual(nf, [{ name: 'quick_reply', buttonParamsJson: '{"display_text":"Admin","id":".menu admin"}' }])
const inter = buildInteractiveMessage({ body: 'hello', footer: 'f', buttons: nf, mentions: ['1@lid'] })
assert.equal(inter.footer.text, 'f'); assert.deepEqual(inter.contextInfo.mentionedJid, ['1@lid'])
const wrapped: any = wrapInteractiveMessage(inter)
assert.ok(wrapped.viewOnceMessage.message.interactiveMessage.nativeFlowMessage)
const inner = wrapped.viewOnceMessage.message
assert.equal(getInteractiveBizNodes(inner, true).length, 2)
assert.equal(getInteractiveBizNodes(inner, false).length, 1)
assert.deepEqual(getInteractiveBizNodes({ conversation: 'x' }, true), [])

// lista + url
const lst = collectNativeFlowButtons({ buttonText: 'Open', sections: [{ title: 'A', rows: [{ title: 'r', rowId: 'id1' }] }],
	interactiveButtons: [{ type: 'url', text: 'S', url: 'https://x' }] })
assert.equal(lst[0]!.name, 'cta_url'); assert.equal(lst[1]!.name, 'single_select')
assert.equal(JSON.parse(lst[1]!.buttonParamsJson).sections[0].rows[0].id, 'id1')

// button reply
assert.equal(getButtonReplyId({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{"id":".x"}' } } }), '.x')
assert.equal(getButtonReplyId({ buttonsResponseMessage: { selectedButtonId: '.y' } }), '.y')

// LID/PN keys
const k1: any = { remoteJid: 'g@g.us', participant: '111@lid', participantAlt: '39333@s.whatsapp.net' }
applyLegacyKeyFields(k1)
assert.deepEqual([k1.senderLid, k1.senderPn, k1.participantLid], ['111@lid', '39333@s.whatsapp.net', '111@lid'])
const k2: any = { remoteJid: 'g@g.us', participant: '39333@s.whatsapp.net', participantAlt: '111@lid' }
applyLegacyKeyFields(k2)
assert.deepEqual([k2.senderLid, k2.senderPn], ['111@lid', '39333@s.whatsapp.net'])
const k3: any = { remoteJid: 'g@g.us', participant: '1@lid', fromMe: true }
applyLegacyKeyFields(k3); assert.equal(k3.senderLid, undefined)

// participants
const p: any = normalizeParticipant({ id: '111@lid', phoneNumber: '39333@s.whatsapp.net', admin: 'admin' })
assert.deepEqual([p.id, p.lid, p.jid], ['111@lid', '111@lid', '39333@s.whatsapp.net'])
const p2: any = normalizeParticipant({ id: '39333@s.whatsapp.net', lid: '111@lid' })
assert.deepEqual([p2.lid, p2.jid], ['111@lid', '39333@s.whatsapp.net'])
const up: any = toLegacyParticipantsUpdate({ id: 'g', participants: [{ id: '111@lid' }, { id: '2@s.whatsapp.net' }] })
assert.deepEqual(up.participants, ['111@lid', '2@s.whatsapp.net']); assert.equal(up.participantsInfo.length, 2)

// pinning
const pn: any = normalizePinContent({ pin: { key: { id: 'A' }, type: 1 }, time: 604800 })
assert.deepEqual([pn.pin.id, pn.type, pn.time], ['A', 1, 604800])
const pn2: any = normalizePinContent({ pin: { id: 'A' }, type: 2 }); assert.equal(pn2.pin.id, 'A')

// socket wrapper: events, getPNById, sendMessage
const emitter: any = new EventEmitter()
const evObj: any = { on: (e: string, l: any) => emitter.on(e, l), off: (e: string, l: any) => emitter.off(e, l), emit: (e: string, d: any) => emitter.emit(e, d) }
let sent: any
const sock: any = {
	ev: evObj,
	signalRepository: { lidMapping: { getPNForLID: async (l: string) => (l === '111@lid' ? '39333:0@s.whatsapp.net' : null), getLIDForPN: async () => '111:0@lid' } },
	sendMessage: async (_j: string, c: any) => { sent = c }
}
applyAeqmCompat(sock)
let got: any
const l = (d: any) => { got = d }
sock.ev.on('group-participants.update', l)
evObj.emit('group-participants.update', { id: 'g', author: 'a', action: 'add', participants: [{ id: '111@lid' }] })
assert.deepEqual(got.participants, ['111@lid'])
sock.ev.off('group-participants.update', l); got = null
evObj.emit('group-participants.update', { participants: [{ id: 'x' }] }); assert.equal(got, null)
assert.equal(await sock.getPNById('111@lid'), '39333@s.whatsapp.net')
assert.equal(await sock.getPNById('999@lid'), null)
assert.equal(await sock.getLIDById('39333@s.whatsapp.net'), '111@lid')
await sock.sendMessage('g', { pin: { key: { id: 'Z' }, type: 1 }, time: 604800 })
assert.equal(sent.pin.id, 'Z')
console.log('aeqm-selftest: ALL CHECKS PASSED')
