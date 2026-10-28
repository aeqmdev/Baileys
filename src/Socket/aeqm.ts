/**
 * @aeqm/baileys — the final socket layer.
 *
 * Adds everything bots written for ChatUnity forks expect on top of official Baileys 7.x
 * (see Utils/aeqm-compat.ts for the list). Each compatibility feature can be disabled
 * through the makeWASocket config:
 *
 *   makeWASocket({
 *     ...,
 *     aeqm: {
 *       legacyParticipants: true,   // group-participants.update -> participants: string[]
 *       legacyPin: true,            // sendMessage({ pin: { key, type }, time })
 *       lidHelpers: true,           // sock.getPNById / sock.getLIDById
 *       buttonsMode: 'native_flow'  // default button mode
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

/** Methods added to the socket by `lidHelpers` (enabled by default); absent when `lidHelpers: false`. */
export type AeqmSocketExtensions = {
	/** LID -> phone-number JID (without a device suffix). `null` if the input is neither a LID nor a phone number, or if no mapping is known. */
	getPNById: (jid: string) => Promise<string | null>
	/** Phone-number JID -> LID (without a device suffix). `null` if the input is neither a phone number nor a LID, or if no mapping is known. */
	getLIDById: (jid: string) => Promise<string | null>
}

// Events whose payload is transformed before it reaches the user listener.
type Transformer = (data: any) => any

export const applyAeqmCompat = <S extends Record<string, any>>(
	sock: S,
	userConfig?: AeqmConfig
): S & Partial<AeqmSocketExtensions> => {
	const cfg = { ...DEFAULTS, ...(userConfig || {}) }

	// ---------------------------------------------------------------------------
	//  1) Events: group-participants.update with participants as strings
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

		// original listener -> wrapped listener (so off() can remove it correctly)
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
	//  2) LID helpers (used by Hastur: getPNById / getLIDById)
	// ---------------------------------------------------------------------------
	if (cfg.lidHelpers) {
		const mapping = () => (sock as any).signalRepository?.lidMapping

		/** LID -> phone-number JID. Returns the input if it is already a phone number; otherwise, returns null when unresolved. */
		extra.getPNById = async (jid: string): Promise<string | null> => {
			if (!jid) return null
			const clean = stripDevice(jid)
			if (isPnJid(clean)) return clean!
			if (!isLidJid(clean)) return null
			const pn = await mapping()?.getPNForLID?.(clean)
			const out = stripDevice(pn)
			return isPnJid(out) ? out : null
		}

		/** Phone-number JID -> LID. Returns the input if it is already a LID; otherwise, returns null when unresolved. */
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
	//  3) sendMessage: alternate pin format + default button mode
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
