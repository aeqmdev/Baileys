import type { GroupParticipant, WAMessageKey } from '../../Types'
import {
	applyLegacyKeyFields,
	computeLegacyKeyFields,
	enrichLegacyKeyFields,
	isLidJid,
	isPnJid,
	normalizeParticipant,
	normalizePinContent,
	participantsToJids,
	stripDevice,
	toLegacyParticipantsUpdate
} from '../../Utils/aeqm-compat'

const LID = '111@lid'
const PN = '39333@s.whatsapp.net'
const GROUP = '120363000000000000@g.us'

describe('stripDevice', () => {
	it('removes the device part from PN and LID jids', () => {
		expect(stripDevice('39333:4@s.whatsapp.net')).toBe(PN)
		expect(stripDevice('111:0@lid')).toBe(LID)
	})

	it('leaves jids without a device untouched', () => {
		expect(stripDevice(PN)).toBe(PN)
		expect(stripDevice(LID)).toBe(LID)
	})

	it('returns undefined for empty input', () => {
		expect(stripDevice(undefined)).toBeUndefined()
		expect(stripDevice(null)).toBeUndefined()
		expect(stripDevice('')).toBeUndefined()
	})

	it('returns a value without a server part as it is', () => {
		expect(stripDevice('status')).toBe('status')
	})
})

describe('isLidJid / isPnJid', () => {
	it('classify user jids by server', () => {
		expect(isLidJid(LID)).toBe(true)
		expect(isLidJid(PN)).toBe(false)
		expect(isPnJid(PN)).toBe(true)
		expect(isPnJid(LID)).toBe(false)
	})

	it('reject groups and empty values', () => {
		expect(isLidJid(GROUP)).toBe(false)
		expect(isPnJid(GROUP)).toBe(false)
		expect(isLidJid(undefined)).toBe(false)
		expect(isPnJid(null)).toBe(false)
		expect(isPnJid('')).toBe(false)
	})
})

describe('computeLegacyKeyFields', () => {
	it('uses participant/participantAlt in groups when the sender is a LID', () => {
		const key: WAMessageKey = { remoteJid: GROUP, participant: LID, participantAlt: PN }

		expect(computeLegacyKeyFields(key)).toEqual({ senderLid: LID, participantLid: LID, senderPn: PN })
	})

	it('uses participant/participantAlt in groups when the sender is a phone number', () => {
		const key: WAMessageKey = { remoteJid: GROUP, participant: PN, participantAlt: LID }

		expect(computeLegacyKeyFields(key)).toEqual({ senderPn: PN, senderLid: LID, participantLid: LID })
	})

	it('only sets what the key carries', () => {
		expect(computeLegacyKeyFields({ remoteJid: GROUP, participant: PN })).toEqual({ senderPn: PN })
		expect(computeLegacyKeyFields({ remoteJid: GROUP, participant: LID })).toEqual({
			senderLid: LID,
			participantLid: LID
		})
	})

	it('uses remoteJid/remoteJidAlt in private chats', () => {
		expect(computeLegacyKeyFields({ remoteJid: LID, remoteJidAlt: PN })).toEqual({
			senderLid: LID,
			participantLid: LID,
			senderPn: PN
		})
		expect(computeLegacyKeyFields({ remoteJid: PN, remoteJidAlt: LID })).toEqual({
			senderPn: PN,
			senderLid: LID,
			participantLid: LID
		})
	})

	it('does not read participant in private chats', () => {
		expect(computeLegacyKeyFields({ remoteJid: PN, participant: LID })).toEqual({ senderPn: PN })
	})

	it('strips device suffixes', () => {
		const key: WAMessageKey = { remoteJid: GROUP, participant: '111:7@lid', participantAlt: '39333:7@s.whatsapp.net' }

		expect(computeLegacyKeyFields(key)).toEqual({ senderLid: LID, participantLid: LID, senderPn: PN })
	})

	it('returns nothing for a key without jids', () => {
		expect(computeLegacyKeyFields({})).toEqual({})
	})
})

describe('applyLegacyKeyFields', () => {
	it('adds the legacy fields to the key and returns the same object', () => {
		const key: WAMessageKey = { remoteJid: GROUP, participant: LID, participantAlt: PN }

		expect(applyLegacyKeyFields(key)).toBe(key)
		expect([key.senderLid, key.senderPn, key.participantLid]).toEqual([LID, PN, LID])
	})

	it('does not overwrite fields already on the key', () => {
		const key: WAMessageKey = { remoteJid: GROUP, participant: LID, participantAlt: PN, senderPn: '1@s.whatsapp.net' }

		applyLegacyKeyFields(key)

		expect(key.senderPn).toBe('1@s.whatsapp.net')
	})

	it('skips messages sent by us', () => {
		const key: WAMessageKey = { remoteJid: GROUP, participant: LID, fromMe: true }

		applyLegacyKeyFields(key)

		expect(key.senderLid).toBeUndefined()
		expect(key.participantLid).toBeUndefined()
	})

	it('lets resolved values fill the phone number when the key has no alt', () => {
		const key: WAMessageKey = { remoteJid: GROUP, participant: LID }

		applyLegacyKeyFields(key, { senderPn: PN })

		expect(key.senderPn).toBe(PN)
	})
})

describe('enrichLegacyKeyFields', () => {
	it('resolves the phone number of a LID sender from the local mapping', async () => {
		const key: WAMessageKey = { remoteJid: GROUP, participant: LID }
		const lookups: string[] = []

		await enrichLegacyKeyFields(key, lid => {
			lookups.push(lid)
			return Promise.resolve('39333:0@s.whatsapp.net')
		})

		expect(lookups).toEqual([LID])
		expect(key.senderLid).toBe(LID)
		expect(key.senderPn).toBe(PN)
	})

	it('does not query the mapping when the key already carries the phone number', async () => {
		const key: WAMessageKey = { remoteJid: GROUP, participant: LID, participantAlt: PN }
		const lookups: string[] = []

		await enrichLegacyKeyFields(key, lid => {
			lookups.push(lid)
			return Promise.resolve(null)
		})

		expect(lookups).toEqual([])
		expect(key.senderPn).toBe(PN)
	})

	it('ignores mapping results that are not phone number jids', async () => {
		const unknown: WAMessageKey = { remoteJid: GROUP, participant: LID }
		const wrongKind: WAMessageKey = { remoteJid: GROUP, participant: LID }

		await enrichLegacyKeyFields(unknown, () => Promise.resolve(null))
		await enrichLegacyKeyFields(wrongKind, () => Promise.resolve('222@lid'))

		expect(unknown.senderPn).toBeUndefined()
		expect(wrongKind.senderPn).toBeUndefined()
	})

	it('keeps the derived fields when the mapping lookup fails', async () => {
		const key: WAMessageKey = { remoteJid: GROUP, participant: LID }

		await enrichLegacyKeyFields(key, () => Promise.reject(new Error('mapping unavailable')))

		expect(key.senderLid).toBe(LID)
		expect(key.senderPn).toBeUndefined()
	})

	it('does not touch messages sent by us', async () => {
		const key: WAMessageKey = { remoteJid: GROUP, participant: LID, fromMe: true }
		const lookups: string[] = []

		await enrichLegacyKeyFields(key, lid => {
			lookups.push(lid)
			return Promise.resolve(PN)
		})

		expect(lookups).toEqual([])
		expect(key.senderLid).toBeUndefined()
	})

	it('only derives the fields from the key when no mapping is given', async () => {
		const key: WAMessageKey = { remoteJid: GROUP, participant: LID, participantAlt: PN }

		expect(await enrichLegacyKeyFields(key)).toBe(key)
		expect(key.senderPn).toBe(PN)
	})
})

describe('normalizeParticipant', () => {
	const normalize = (participant: GroupParticipant): GroupParticipant => normalizeParticipant(participant)

	it('derives lid from a LID id and keeps the phone number as jid', () => {
		const participant = normalize({ id: LID, phoneNumber: PN, admin: 'admin' })

		expect([participant.id, participant.lid, participant.jid, participant.phoneNumber]).toEqual([LID, LID, PN, PN])
		expect(participant.admin).toBe('admin')
	})

	it('derives jid and phoneNumber from a PN id and keeps the provided lid', () => {
		const participant = normalize({ id: PN, lid: LID })

		expect([participant.id, participant.lid, participant.jid, participant.phoneNumber]).toEqual([PN, LID, PN, PN])
	})

	it('fills phoneNumber from an explicit jid', () => {
		expect(normalize({ id: LID, jid: PN }).phoneNumber).toBe(PN)
	})

	it('leaves jid and phoneNumber unset when the number is unknown', () => {
		const participant = normalize({ id: LID })

		expect(participant.lid).toBe(LID)
		expect(participant.jid).toBeUndefined()
		expect(participant.phoneNumber).toBeUndefined()
	})

	it('does not mutate its input', () => {
		const input: GroupParticipant = { id: LID, phoneNumber: PN }

		normalize(input)

		expect(input).toEqual({ id: LID, phoneNumber: PN })
	})
})

describe('participantsToJids', () => {
	it('maps objects to their id and keeps strings', () => {
		expect(participantsToJids([LID, { id: PN }])).toEqual([LID, PN])
	})

	it('drops entries without an id', () => {
		expect(participantsToJids([{ id: '' }, { id: PN }])).toEqual([PN])
	})
})

describe('toLegacyParticipantsUpdate', () => {
	const makeUpdate = () => ({
		id: GROUP,
		author: LID,
		action: 'add' as const,
		participants: [
			{ id: LID, phoneNumber: PN },
			{ id: PN, lid: LID }
		]
	})

	it('turns participants into jid strings and moves the objects to participantsInfo', () => {
		const result = toLegacyParticipantsUpdate(makeUpdate())

		expect(result.participants).toEqual([LID, PN])
		expect(result.participantsInfo.map(p => [p.id, p.lid, p.jid, p.phoneNumber])).toEqual([
			[LID, LID, PN, PN],
			[PN, LID, PN, PN]
		])
	})

	it('keeps every other field of the update', () => {
		const result = toLegacyParticipantsUpdate(makeUpdate())

		expect([result.id, result.author, result.action]).toEqual([GROUP, LID, 'add'])
	})

	it('does not mutate the original update', () => {
		const update = makeUpdate()

		toLegacyParticipantsUpdate(update)

		expect(update).toEqual(makeUpdate())
		expect('participantsInfo' in update).toBe(false)
	})

	it('accepts participants that are already strings', () => {
		const result = toLegacyParticipantsUpdate({ participants: [LID] })

		expect(result.participants).toEqual([LID])
		expect(result.participantsInfo).toEqual([{ id: LID }])
	})

	it('returns payloads without a participants array as they are', () => {
		const payload = { id: GROUP } as unknown as { participants: string[] }

		expect(toLegacyParticipantsUpdate(payload)).toBe(payload)
	})
})

describe('normalizePinContent', () => {
	const key = { remoteJid: GROUP, fromMe: false, id: 'ABC' }

	it('rewrites the nested { pin: { key, type }, time } form to the official one', () => {
		expect(normalizePinContent({ pin: { key, type: 1 }, time: 604800 })).toEqual({ pin: key, type: 1, time: 604800 })
	})

	it('defaults the type to 1 (pin for all) when none is given', () => {
		expect(normalizePinContent({ pin: { key } })).toEqual({ pin: key, type: 1 })
	})

	it('uses the type of the outer content when the nested pin has none', () => {
		expect(normalizePinContent({ pin: { key }, type: 2 })).toEqual({ pin: key, type: 2 })
	})

	it('prefers the outer time over the nested one', () => {
		expect(normalizePinContent({ pin: { key, type: 1, time: 86400 }, time: 604800 })).toEqual({
			pin: key,
			type: 1,
			time: 604800
		})
	})

	it('falls back to the nested time', () => {
		expect(normalizePinContent({ pin: { key, type: 1, time: 86400 } })).toEqual({ pin: key, type: 1, time: 86400 })
	})

	it('omits time when none is given', () => {
		expect('time' in normalizePinContent({ pin: { key, type: 1 } })).toBe(false)
	})

	it('returns the official form unchanged', () => {
		const official = { pin: key, type: 2, time: 86400 }

		expect(normalizePinContent(official)).toBe(official)
	})

	it('returns content that is not a pin unchanged', () => {
		const text = { text: 'hi' }

		expect(normalizePinContent(text)).toBe(text)
		expect(normalizePinContent(undefined)).toBeUndefined()
		expect(normalizePinContent(null)).toBeNull()
		expect(normalizePinContent('hi')).toBe('hi')
	})
})
