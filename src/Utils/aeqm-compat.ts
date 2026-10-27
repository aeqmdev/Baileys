/**
 * @aeqm/baileys — livello di compatibilità.
 *
 * Questo file NON importa nulla di "pesante" (solo tipi): le funzioni sono pure,
 * così si possono testare senza avviare un socket.
 *
 * Perché esiste: molti bot (compreso Hastur) sono scritti per le fork "ChatUnity"
 * e simili, che rispetto al Baileys ufficiale 7.x espongono:
 *   - m.key.senderPn / m.key.senderLid / m.key.participantLid
 *   - partecipanti dei gruppi con i tre campi id / lid / jid
 *   - group-participants.update con `participants` come array di STRINGHE (JID)
 *   - sock.getPNById(lid) / sock.getLIDById(pn)
 *   - sendMessage(jid, { pin: { key, type }, time })
 */

import type { WAMessageKey } from '../Types/Message'

const LID_RE = /@lid$/
const PN_RE = /@s\.whatsapp\.net$/

export const isLidJid = (jid?: string | null): jid is string => !!jid && LID_RE.test(jid)
export const isPnJid = (jid?: string | null): jid is string => !!jid && PN_RE.test(jid)

/** Toglie la parte ":device" da un JID (123:4@s.whatsapp.net -> 123@s.whatsapp.net). */
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
 * Calcola i campi "legacy" a partire da ciò che Baileys 7 già mette sulla chiave
 * (participant/participantAlt per i gruppi, remoteJid/remoteJidAlt per le chat private).
 * Non fa richieste di rete: usa solo i dati presenti.
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

/** Aggiunge (senza sovrascrivere) senderPn / senderLid / participantLid alla chiave. */
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
 * Normalizza un partecipante di gruppo: oltre a `id` (che segue l'addressing mode
 * del gruppo) garantisce `lid` (se noto), `jid` (numero di telefono, se noto) e
 * `phoneNumber`. Così il confronto su [p.id, p.lid, p.jid] funziona sempre.
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

/** Da array di oggetti-partecipante (o stringhe) a array di JID stringa. */
export const participantsToJids = (participants: Array<string | ParticipantLike>): string[] =>
	(participants || []).map(p => (typeof p === 'string' ? p : p?.id)).filter((x): x is string => !!x)

/**
 * Trasforma il payload di 'group-participants.update' nel formato "legacy":
 *   participants -> string[]
 *   participantsInfo -> gli oggetti originali (normalizzati), per chi li vuole
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
 * Accetta sia la forma ufficiale { pin: <key>, type, time } sia la forma usata
 * dalle fork ChatUnity { pin: { key, type, time? }, time? }.
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
 * Versione asincrona di applyLegacyKeyFields: se manca il numero di telefono di un
 * mittente @lid prova a ricavarlo dalla mappatura LID<->PN già salvata (SOLO lettura
 * locale: nessuna richiesta di rete nel percorso di ricezione del messaggio).
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
				// mappatura non disponibile: si riprova al messaggio successivo
			}
		}
	}

	return key
}
