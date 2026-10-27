import { Boom } from '@hapi/boom'
import { extractGroupMetadata } from '../../Socket/groups'
import type { BinaryNode } from '../../WABinary'

const minimalGroupNode = (overrides: Partial<BinaryNode['attrs']> = {}): BinaryNode => ({
	tag: 'group',
	attrs: {
		id: '120363000000000000',
		creation: '1700000000',
		s_t: '1700000000',
		subject: 'Test Group',
		...overrides
	},
	content: []
})

describe('extractGroupMetadata', () => {
	it('parses a valid <group> node', () => {
		const result: BinaryNode = {
			tag: 'iq',
			attrs: { type: 'result' },
			content: [minimalGroupNode()]
		}

		const meta = extractGroupMetadata(result)

		expect(meta.id).toBe('120363000000000000@g.us')
		expect(meta.subject).toBe('Test Group')
	})

	it('keeps the @-suffix when group id already contains it', () => {
		const result: BinaryNode = {
			tag: 'iq',
			attrs: { type: 'result' },
			content: [minimalGroupNode({ id: '120363000000000000@g.us' })]
		}

		expect(extractGroupMetadata(result).id).toBe('120363000000000000@g.us')
	})

	it('throws Boom with the server <error> code+text when no <group> is present', () => {
		const result: BinaryNode = {
			tag: 'iq',
			attrs: { type: 'error' },
			content: [
				{
					tag: 'error',
					attrs: { code: '403', text: 'forbidden' }
				}
			]
		}

		const captured = captureThrow(() => extractGroupMetadata(result))
		expect(captured).toBeInstanceOf(Boom)
		expect((captured as Boom).output.statusCode).toBe(403)
		expect((captured as Error).message).toBe('forbidden')
	})

	it('falls back to a generic Boom when neither <group> nor <error> is present', () => {
		const result: BinaryNode = { tag: 'iq', attrs: { type: 'result' }, content: [] }

		expect(() => extractGroupMetadata(result)).toThrow(/missing <group>/)
	})

	it('throws when the <group> node lacks an id', () => {
		const group = minimalGroupNode()
		delete (group.attrs as Record<string, string>).id
		const result: BinaryNode = { tag: 'iq', attrs: { type: 'result' }, content: [group] }

		expect(() => extractGroupMetadata(result)).toThrow(/missing group id/)
	})

	it('uses default code 500 when <error> has no code attribute', () => {
		const result: BinaryNode = {
			tag: 'iq',
			attrs: { type: 'error' },
			content: [{ tag: 'error', attrs: {} }]
		}

		const captured = captureThrow(() => extractGroupMetadata(result))
		expect((captured as Boom).output.statusCode).toBe(500)
	})
})

describe('extractGroupMetadata participants (LID/PN fields)', () => {
	const LID = '111@lid'
	const PN = '39333@s.whatsapp.net'

	const groupWithParticipants = (
		participants: BinaryNode['attrs'][],
		overrides: Partial<BinaryNode['attrs']> = {}
	): BinaryNode => ({
		tag: 'iq',
		attrs: { type: 'result' },
		content: [
			{
				...minimalGroupNode(overrides),
				content: participants.map(attrs => ({ tag: 'participant', attrs }))
			}
		]
	})

	it('exposes id, lid, jid and phoneNumber for a LID-addressed participant', () => {
		const meta = extractGroupMetadata(
			groupWithParticipants([{ jid: LID, phone_number: PN, type: 'admin' }], { addressing_mode: 'lid' })
		)

		expect(meta.participants).toEqual([{ id: LID, lid: LID, jid: PN, phoneNumber: PN, admin: 'admin' }])
	})

	it('exposes id, lid, jid and phoneNumber for a PN-addressed participant', () => {
		const meta = extractGroupMetadata(groupWithParticipants([{ jid: PN, lid: '222@lid' }]))

		expect(meta.participants).toEqual([{ id: PN, lid: '222@lid', jid: PN, phoneNumber: PN, admin: null }])
	})

	it('keeps the order of the participants', () => {
		const meta = extractGroupMetadata(groupWithParticipants([{ jid: PN }, { jid: LID }]))

		expect(meta.participants.map(p => p.id)).toEqual([PN, LID])
	})

	it('leaves jid and phoneNumber unset for a LID participant whose number is unknown', () => {
		const [participant] = extractGroupMetadata(groupWithParticipants([{ jid: LID }])).participants

		expect(participant?.lid).toBe(LID)
		expect(participant?.jid).toBeUndefined()
		expect(participant?.phoneNumber).toBeUndefined()
	})

	it('leaves lid unset for a PN participant whose LID is unknown', () => {
		const [participant] = extractGroupMetadata(groupWithParticipants([{ jid: PN }])).participants

		expect(participant?.jid).toBe(PN)
		expect(participant?.phoneNumber).toBe(PN)
		expect(participant?.lid).toBeUndefined()
	})

	it('ignores a phone_number that is not a phone number jid', () => {
		const [participant] = extractGroupMetadata(
			groupWithParticipants([{ jid: LID, phone_number: 'not-a-jid' }])
		).participants

		expect(participant?.jid).toBeUndefined()
		expect(participant?.phoneNumber).toBeUndefined()
	})

	it('reads phone_number only for LID participants', () => {
		const [participant] = extractGroupMetadata(
			groupWithParticipants([{ jid: PN, phone_number: '1@s.whatsapp.net' }])
		).participants

		expect(participant?.phoneNumber).toBe(PN)
	})

	it('maps the participant type to admin and the username attribute to username', () => {
		const meta = extractGroupMetadata(
			groupWithParticipants([
				{ jid: PN, type: 'superadmin' },
				{ jid: LID, participant_username: 'alice' }
			])
		)

		expect(meta.participants.map(p => p.admin)).toEqual(['superadmin', null])
		expect(meta.participants[1]?.username).toBe('alice')
	})
})

const captureThrow = (fn: () => unknown): unknown => {
	try {
		fn()
	} catch (err) {
		return err
	}

	throw new Error('expected function to throw')
}
