/**
 * @aeqm/baileys — compatibility layer.
 *
 * This file imports nothing "heavy" (types only): its functions are pure, so they can be
 * tested without starting a socket.
 *
 * Why it exists: some existing integrations expect these fields and formats in addition
 * to official Baileys 7.x:
 *   - m.key.senderPn / m.key.senderLid / m.key.participantLid
 *   - group participants with the three fields id / lid / jid
 *   - group-participants.update with `participants` as an array of JID strings
 *   - sock.getPNById(lid) / sock.getLIDById(pn)
 *   - sendMessage(jid, { pin: { key, type }, time })
 */

import type { WAMessageKey } from '../Types/Message'

const LID_RE = /@lid$/
const PN_RE = /@s\.whatsapp\.net$/

export const isLidJid = (jid?: string | null): jid is string => !!jid && LID_RE.test(jid)
export const isPnJid = (jid?: string | null): jid is string => !!jid && PN_RE.test(jid)

/** Removes the ":device" suffix from a JID (123:4@s.whatsapp.net -> 123@s.whatsapp.net). */
export const stripDevice = (jid?: string | null): string | undefined => {
	if (!jid) return undefined
	const at = jid.indexOf('@')
	if (at < 0) return jid
	const user = jid.slice(0, at).split(':')[0]
	return `${user}${jid.slice(at)}`
}

type LegacyKeyFields = {
	senderPn?: string
	senderLid?: string
	participantLid?: string
}

/**
 * Computes the "legacy" fields from data Baileys 7 already puts on the key
 * (participant/participantAlt for groups, remoteJid/remoteJidAlt for private chats).
 * It makes no network requests and uses only the available data.
 */
export const computeLegacyKeyFields = (key: WAMessageKey): LegacyKeyFields => {
	const isGroup = !!key.remoteJid && key.remoteJid.endsWith('@g.us')
	const primary = isGroup ? key.participant : key.remoteJid
	const alt = isGroup ? key.participantAlt : key.remoteJidAlt

	const out: LegacyKeyFields = {}
	const primaryClean = stripDevice(primary)
	const altClean = stripDevice(alt)

	if (isLidJid(primaryClean)) {
		out.senderLid = primaryClean
		out.participantLid = primaryClean
		if (isPnJid(altClean)) out.senderPn = altClean
	} else if (isPnJid(primaryClean)) {
		out.senderPn = primaryClean
		if (isLidJid(altClean)) {
			out.senderLid = altClean
			out.participantLid = altClean
		}
	}

	return out
}

/** Adds senderPn / senderLid / participantLid to the key without overwriting existing values. */
export const applyLegacyKeyFields = (key: WAMessageKey, resolved?: LegacyKeyFields): WAMessageKey => {
	if (!key || key.fromMe) return key
	const computed = { ...computeLegacyKeyFields(key), ...(resolved || {}) }
	const target = key as WAMessageKey & LegacyKeyFields
	if (computed.senderPn && !target.senderPn) target.senderPn = computed.senderPn
	if (computed.senderLid && !target.senderLid) target.senderLid = computed.senderLid
	if (computed.participantLid && !target.participantLid) target.participantLid = computed.participantLid
	return key
}

type ParticipantLike = {
	id: string
	lid?: string
	phoneNumber?: string
	jid?: string
	[k: string]: any
}

/**
 * Normalizes a group participant: in addition to `id` (which follows the group's
 * addressing mode), it ensures `lid` (if known), `jid` (phone-number JID, if known), and
 * `phoneNumber`. This makes comparisons across [p.id, p.lid, p.jid] consistent.
 */
export const normalizeParticipant = <P extends ParticipantLike>(p: P): P & { jid?: string; lid?: string } => {
	if (!p || typeof p !== 'object') return p
	const idIsLid = isLidJid(p.id)
	const idIsPn = isPnJid(p.id)
	const lid = p.lid || (idIsLid ? p.id : undefined)
	const jid = p.jid || p.phoneNumber || (idIsPn ? p.id : undefined)
	const out: any = { ...p }
	if (lid) out.lid = lid
	if (jid) {
		out.jid = jid
		if (!out.phoneNumber) out.phoneNumber = jid
	}
	return out
}

/** Converts an array of participant objects (or strings) to an array of JID strings. */
export const participantsToJids = (participants: Array<string | ParticipantLike>): string[] =>
	(participants || []).map(p => (typeof p === 'string' ? p : p?.id)).filter((x): x is string => !!x)

/**
 * Converts the 'group-participants.update' payload to the "legacy" format:
 *   participants -> string[]
 *   participantsInfo -> the original (normalized) objects, for consumers that need them.
 */
export const toLegacyParticipantsUpdate = <U extends { participants: any[] }>(update: U) => {
	if (!update || !Array.isArray(update.participants)) return update
	const info = update.participants.map(p => (typeof p === 'string' ? { id: p } : normalizeParticipant(p)))
	return {
		...update,
		participants: participantsToJids(update.participants),
		participantsInfo: info
	}
}

/**
 * Accepts both the official format `{ pin: <key>, type, time }` and the format used by
 * Legacy format: `{ pin: { key, type, time? }, time? }`.
 */
export const normalizePinContent = (content: any): any => {
	if (!content || typeof content !== 'object') return content
	const pin = content.pin
	if (!pin || typeof pin !== 'object' || !pin.key || typeof pin.key !== 'object') return content
	const { key, type, time } = pin
	const out: any = { ...content, pin: key, type: type ?? content.type ?? 1 }
	const t = content.time ?? time
	if (t !== undefined) out.time = t
	return out
}

/**
 * Asynchronous version of applyLegacyKeyFields: if an @lid sender's phone number is
 * missing, it tries to retrieve it from the existing LID<->PN mapping (LOCAL READ ONLY;
 * no network requests are made while receiving the message).
 */
export const enrichLegacyKeyFields = async (
	key: WAMessageKey,
	getPNForLID?: (lid: string) => Promise<string | null | undefined>
): Promise<WAMessageKey> => {
	if (!key || key.fromMe) return key
	applyLegacyKeyFields(key)

	const target = key as WAMessageKey & LegacyKeyFields
	if (!target.senderPn && getPNForLID) {
		const lid = target.senderLid
		if (lid) {
			try {
				const pn = await getPNForLID(lid)
				const clean = stripDevice(pn)
				if (isPnJid(clean)) target.senderPn = clean
			} catch {
				// Mapping unavailable; try again with the next message.
			}
		}
	}

	return key
}
