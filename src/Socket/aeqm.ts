/**
 * @aeqm/baileys — ultimo strato del socket.
 *
 * Aggiunge sopra il Baileys 7.x ufficiale tutto ciò che i bot scritti per le fork
 * ChatUnity si aspettano (vedi Utils/aeqm-compat.ts per l'elenco). Ogni compatibilità
 * si può spegnere dalla config di makeWASocket:
 *
 *   makeWASocket({
 *     ...,
 *     aeqm: {
 *       legacyParticipants: true,   // group-participants.update -> participants: string[]
 *       legacyPin: true,            // sendMessage({ pin: { key, type }, time })
 *       lidHelpers: true,           // sock.getPNById / sock.getLIDById
 *       buttonsMode: 'native_flow'  // modalità predefinita dei pulsanti
 *     }
 *   })
 */

import { hasInteractiveContent, type AeqmButtonsMode } from '../Utils/aeqm-buttons'
import { isLidJid, isPnJid, normalizePinContent, stripDevice, toLegacyParticipantsUpdate } from '../Utils/aeqm-compat'

export type AeqmConfig = {
	legacyParticipants?: boolean
	legacyPin?: boolean
	lidHelpers?: boolean
	buttonsMode?: AeqmButtonsMode
}

const DEFAULTS: Required<AeqmConfig> = {
	legacyParticipants: true,
	legacyPin: true,
	lidHelpers: true,
	buttonsMode: 'native_flow'
}

/** Metodi aggiunti al socket da `lidHelpers` (attivo per default); assenti con `lidHelpers: false`. */
export type AeqmSocketExtensions = {
	/** LID -> JID del numero di telefono (senza device). `null` se non è un LID/numero o la mappatura non lo conosce. */
	getPNById: (jid: string) => Promise<string | null>
	/** JID del numero di telefono -> LID (senza device). `null` se non è un numero/LID o la mappatura non lo conosce. */
	getLIDById: (jid: string) => Promise<string | null>
}

// Eventi il cui payload viene trasformato prima di arrivare al listener dell'utente.
type Transformer = (data: any) => any

export const applyAeqmCompat = <S extends Record<string, any>>(
	sock: S,
	userConfig?: AeqmConfig
): S & Partial<AeqmSocketExtensions> => {
	const cfg = { ...DEFAULTS, ...(userConfig || {}) }

	// ---------------------------------------------------------------------------
	//  1) Eventi: group-participants.update con participants come stringhe
	// ---------------------------------------------------------------------------
	const transformers: Record<string, Transformer> = {}
	if (cfg.legacyParticipants) {
		transformers['group-participants.update'] = toLegacyParticipantsUpdate
	}

	const ev: any = sock.ev
	if (ev && Object.keys(transformers).length) {
		const originalOn = ev.on.bind(ev)
		const originalOff = ev.off.bind(ev)
		const originalProcess = typeof ev.process === 'function' ? ev.process.bind(ev) : undefined

		// listener originale -> listener "avvolto" (per poter fare off() correttamente)
		const wrappedListeners = new WeakMap<(...a: any[]) => any, (...a: any[]) => any>()

		ev.on = (event: string, listener: (...a: any[]) => any) => {
			const transform = transformers[event]
			if (!transform || typeof listener !== 'function') return originalOn(event, listener)

			let wrapped = wrappedListeners.get(listener)
			if (!wrapped) {
				wrapped = (data: any) => listener(transform(data))
				wrappedListeners.set(listener, wrapped)
			}

			return originalOn(event, wrapped)
		}

		ev.off = (event: string, listener: (...a: any[]) => any) => {
			const wrapped = wrappedListeners.get(listener)
			return originalOff(event, wrapped && transformers[event] ? wrapped : listener)
		}

		if (originalProcess) {
			ev.process = (handler: (map: Record<string, any>) => any) =>
				originalProcess((map: Record<string, any>) => {
					let out = map
					for (const name of Object.keys(transformers)) {
						if (map[name] !== undefined) {
							if (out === map) out = { ...map }
							out[name] = transformers[name]!(map[name])
						}
					}

					return handler(out)
				})
		}
	}

	const extra: Record<string, any> = {}

	// ---------------------------------------------------------------------------
	//  2) Helper LID <-> numero (usati da Hastur: getPNById / getLIDById)
	// ---------------------------------------------------------------------------
	if (cfg.lidHelpers) {
		const mapping = () => (sock as any).signalRepository?.lidMapping

		/** LID -> JID del numero di telefono. Se è già un numero lo restituisce; altrimenti null. */
		extra.getPNById = async (jid: string): Promise<string | null> => {
			if (!jid) return null
			const clean = stripDevice(jid)
			if (isPnJid(clean)) return clean!
			if (!isLidJid(clean)) return null
			const pn = await mapping()?.getPNForLID?.(clean)
			const out = stripDevice(pn)
			return isPnJid(out) ? out : null
		}

		/** JID del numero di telefono -> LID. Se è già un LID lo restituisce; altrimenti null. */
		extra.getLIDById = async (jid: string): Promise<string | null> => {
			if (!jid) return null
			const clean = stripDevice(jid)
			if (isLidJid(clean)) return clean!
			if (!isPnJid(clean)) return null
			const lid = await mapping()?.getLIDForPN?.(clean)
			const out = stripDevice(lid)
			return isLidJid(out) ? out : null
		}
	}

	// ---------------------------------------------------------------------------
	//  3) sendMessage: forma alternativa di pin + modalità pulsanti predefinita
	// ---------------------------------------------------------------------------
	if (typeof sock.sendMessage === 'function') {
		const originalSend = sock.sendMessage.bind(sock)
		extra.sendMessage = (jid: string, content: any, options?: any) => {
			let c = content
			if (cfg.legacyPin) c = normalizePinContent(c)

			if (hasInteractiveContent(c) && c.buttonsMode === undefined && cfg.buttonsMode !== 'native_flow') {
				c = { ...c, buttonsMode: cfg.buttonsMode }
			}

			return originalSend(jid, c, options)
		}
	}

	return Object.assign(sock, extra) as S & Partial<AeqmSocketExtensions>
}
