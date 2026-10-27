import { type AeqmConfig, applyAeqmCompat } from '../../Socket/aeqm'
import type { BaileysEventMap } from '../../Types'
import { makeEventBuffer } from '../../Utils/event-buffer'
import type { ILogger } from '../../Utils/logger'

const LID = '111@lid'
const PN = '39333@s.whatsapp.net'
const OTHER_LID = '222@lid'
const GROUP = '120363000000000000@g.us'

const makeTestLogger = (): ILogger =>
	({
		level: 'silent',
		child: () => makeTestLogger(),
		trace: () => {},
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
		fatal: () => {}
	}) as unknown as ILogger

type ParticipantsUpdate = BaileysEventMap['group-participants.update']
// What a listener really receives while `legacyParticipants` is on: the typed event says GroupParticipant[].
type LegacyParticipantsUpdate = Omit<ParticipantsUpdate, 'participants'> & { participants: string[] }

const asLegacy = (update: ParticipantsUpdate | undefined) => update as unknown as LegacyParticipantsUpdate

const makePayload = (): ParticipantsUpdate => ({
	id: GROUP,
	author: LID,
	action: 'add',
	participants: [
		{ id: LID, phoneNumber: PN, admin: null },
		{ id: PN, lid: OTHER_LID }
	]
})

type SentMessage = { jid: string; content: unknown; options: unknown }

const makeSock = (config?: AeqmConfig) => {
	const sent: SentMessage[] = []
	const sock = applyAeqmCompat(
		{
			ev: makeEventBuffer(makeTestLogger()),
			signalRepository: {
				lidMapping: {
					getPNForLID: (lid: string) => Promise.resolve(lid === LID ? '39333:0@s.whatsapp.net' : null),
					getLIDForPN: (pn: string) => Promise.resolve(pn === PN ? '111:0@lid' : null)
				}
			},
			sendMessage: (jid: string, content: unknown, options?: unknown) => {
				sent.push({ jid, content, options })
				return Promise.resolve(undefined)
			}
		},
		config
	)

	return { sock, sent }
}

const listenToParticipants = (sock: ReturnType<typeof makeSock>['sock']) => {
	const received: ParticipantsUpdate[] = []
	const listener = (update: ParticipantsUpdate) => {
		received.push(update)
	}

	sock.ev.on('group-participants.update', listener)
	return { received, listener }
}

describe('applyAeqmCompat', () => {
	describe('legacyParticipants (default)', () => {
		it('delivers participants as jid strings to ev.on listeners', () => {
			const { sock } = makeSock()
			const { received } = listenToParticipants(sock)

			sock.ev.emit('group-participants.update', makePayload())

			expect(received).toHaveLength(1)
			expect(asLegacy(received[0]).participants).toEqual([LID, PN])
		})

		it('exposes the full participants in participantsInfo with id, lid, jid and phoneNumber', () => {
			const { sock } = makeSock()
			const { received } = listenToParticipants(sock)

			sock.ev.emit('group-participants.update', makePayload())

			const info = received[0]?.participantsInfo
			expect(info?.map(p => [p.id, p.lid, p.jid, p.phoneNumber])).toEqual([
				[LID, LID, PN, PN],
				[PN, OTHER_LID, PN, PN]
			])
			expect(info?.[0]?.admin).toBeNull()
		})

		it('keeps the other fields of the payload', () => {
			const { sock } = makeSock()
			const { received } = listenToParticipants(sock)

			sock.ev.emit('group-participants.update', makePayload())

			expect([received[0]?.id, received[0]?.author, received[0]?.action]).toEqual([GROUP, LID, 'add'])
		})

		it('does not mutate the emitted payload', () => {
			const { sock } = makeSock()
			listenToParticipants(sock)
			const payload = makePayload()

			sock.ev.emit('group-participants.update', payload)

			expect(payload).toEqual(makePayload())
		})

		it('also transforms the payload seen by ev.process handlers', () => {
			const { sock } = makeSock()
			const events: Partial<BaileysEventMap>[] = []
			sock.ev.process(map => {
				events.push(map)
			})

			sock.ev.emit('group-participants.update', makePayload())

			expect(events).toHaveLength(1)
			const update = events[0]?.['group-participants.update']
			expect(asLegacy(update).participants).toEqual([LID, PN])
			expect(update?.participantsInfo).toHaveLength(2)
		})

		it('leaves other events untouched in ev.process handlers', () => {
			const { sock } = makeSock()
			const events: Partial<BaileysEventMap>[] = []
			sock.ev.process(map => {
				events.push(map)
			})
			const connectionUpdate = { connection: 'open' as const }

			sock.ev.emit('connection.update', connectionUpdate)

			expect(events[0]?.['connection.update']).toBe(connectionUpdate)
		})

		it('leaves other events untouched in ev.on listeners', () => {
			const { sock } = makeSock()
			const received: BaileysEventMap['groups.update'][] = []
			sock.ev.on('groups.update', update => {
				received.push(update)
			})
			const update = [{ id: GROUP, subject: 'New subject' }]

			sock.ev.emit('groups.update', update)

			expect(received[0]).toBe(update)
		})

		it('transforms the payload while the event buffer is active', () => {
			const { sock } = makeSock()
			const { received } = listenToParticipants(sock)

			sock.ev.buffer()
			sock.ev.emit('group-participants.update', makePayload())
			sock.ev.flush()

			expect(received).toHaveLength(1)
			expect(asLegacy(received[0]).participants).toEqual([LID, PN])
		})

		it('stops delivering events once the listener is removed with ev.off', () => {
			const { sock } = makeSock()
			const { received, listener } = listenToParticipants(sock)

			sock.ev.emit('group-participants.update', makePayload())
			sock.ev.off('group-participants.update', listener)
			sock.ev.emit('group-participants.update', makePayload())

			expect(received).toHaveLength(1)
		})
	})

	describe('legacyParticipants: false', () => {
		it('delivers the upstream payload untouched', () => {
			const { sock } = makeSock({ legacyParticipants: false })
			const { received } = listenToParticipants(sock)
			const payload = makePayload()

			sock.ev.emit('group-participants.update', payload)

			expect(received[0]).toBe(payload)
			expect(received[0]?.participantsInfo).toBeUndefined()
		})
	})

	describe('lidHelpers', () => {
		it('getPNById resolves a LID to the phone number jid without device', async () => {
			const { sock } = makeSock()

			expect(await sock.getPNById!(LID)).toBe(PN)
			expect(await sock.getPNById!('111:7@lid')).toBe(PN)
		})

		it('getPNById returns a phone number jid as it is, without device', async () => {
			const { sock } = makeSock()

			expect(await sock.getPNById!('39333:4@s.whatsapp.net')).toBe(PN)
		})

		it('getPNById returns null for unknown LIDs and for jids that are neither', async () => {
			const { sock } = makeSock()

			expect(await sock.getPNById!('999@lid')).toBeNull()
			expect(await sock.getPNById!(GROUP)).toBeNull()
			expect(await sock.getPNById!('')).toBeNull()
		})

		it('getLIDById resolves a phone number to the LID without device', async () => {
			const { sock } = makeSock()

			expect(await sock.getLIDById!(PN)).toBe(LID)
			expect(await sock.getLIDById!('39333:4@s.whatsapp.net')).toBe(LID)
		})

		it('getLIDById returns a LID as it is, without device', async () => {
			const { sock } = makeSock()

			expect(await sock.getLIDById!('111:7@lid')).toBe(LID)
		})

		it('getLIDById returns null for unknown numbers and for jids that are neither', async () => {
			const { sock } = makeSock()

			expect(await sock.getLIDById!('1@s.whatsapp.net')).toBeNull()
			expect(await sock.getLIDById!(GROUP)).toBeNull()
			expect(await sock.getLIDById!('')).toBeNull()
		})

		it('returns null when the socket has no LID mapping', async () => {
			const sock = applyAeqmCompat({ ev: makeEventBuffer(makeTestLogger()) })

			expect(await sock.getPNById!(LID)).toBeNull()
			expect(await sock.getLIDById!(PN)).toBeNull()
		})

		it('does not add the helpers with lidHelpers: false', () => {
			const { sock } = makeSock({ lidHelpers: false })

			expect(sock.getPNById).toBeUndefined()
			expect(sock.getLIDById).toBeUndefined()
		})
	})

	describe('legacyPin', () => {
		const key = { remoteJid: GROUP, fromMe: false, id: 'ABC' }

		it('rewrites the nested pin form to the official one before sendMessage', async () => {
			const { sock, sent } = makeSock()

			await sock.sendMessage(GROUP, { pin: { key, type: 1 }, time: 604800 })

			expect(sent).toEqual([{ jid: GROUP, content: { pin: key, type: 1, time: 604800 } }])
		})

		it('passes the official pin form through untouched', async () => {
			const { sock, sent } = makeSock()
			const content = { pin: key, type: 2, time: 86400 }

			await sock.sendMessage(GROUP, content)

			expect(sent[0]?.content).toBe(content)
		})

		it('forwards the options argument', async () => {
			const { sock, sent } = makeSock()
			const options = { ephemeralExpiration: 86400 }

			await sock.sendMessage(GROUP, { text: 'hi' }, options)

			expect(sent[0]?.options).toBe(options)
		})

		it('does not rewrite the nested pin form with legacyPin: false', async () => {
			const { sock, sent } = makeSock({ legacyPin: false })
			const content = { pin: { key, type: 1 }, time: 604800 }

			await sock.sendMessage(GROUP, content)

			expect(sent[0]?.content).toBe(content)
		})
	})

	describe('buttonsMode', () => {
		const buttons = [{ buttonId: 'a', buttonText: { displayText: 'A' } }]

		it('leaves interactive content untouched with the default native_flow mode', async () => {
			const { sock, sent } = makeSock()
			const content = { text: 'x', buttons }

			await sock.sendMessage(GROUP, content)

			expect(sent[0]?.content).toBe(content)
		})

		it('applies a configured legacy mode to interactive content', async () => {
			const { sock, sent } = makeSock({ buttonsMode: 'legacy' })

			await sock.sendMessage(GROUP, { text: 'x', buttons })

			expect(sent[0]?.content).toEqual({ text: 'x', buttons, buttonsMode: 'legacy' })
		})

		it('does not add the mode to content that is not interactive', async () => {
			const { sock, sent } = makeSock({ buttonsMode: 'legacy' })
			const content = { text: 'hi' }

			await sock.sendMessage(GROUP, content)

			expect(sent[0]?.content).toBe(content)
		})

		it('keeps the mode set on the message itself', async () => {
			const { sock, sent } = makeSock({ buttonsMode: 'legacy' })
			const content = { text: 'x', buttons, buttonsMode: 'native_flow' }

			await sock.sendMessage(GROUP, content)

			expect(sent[0]?.content).toBe(content)
		})
	})
})
